import { LLMProvider, UnifiedChatRequest, UnifiedMessage } from "../types/llm";
import { Transformer } from "../types/transformer";
import { log } from "../utils/log";

export class OpenAITransformer implements Transformer {
  name = "openai";

  endPoint = "/v1/chat/completions";

  async transformRequestIn(
    request: UnifiedChatRequest,
    provider: LLMProvider
  ): Promise<Record<string, any>> {
    const messages: Record<string, any>[] = request.messages.map(
      (message: UnifiedMessage) => {
        let role: "user" | "assistant" | "system" | "tool";
        if (message.role === "assistant") {
          role = "assistant";
        } else if (message.role === "user") {
          role = "user";
        } else if (message.role === "system") {
          role = "system";
        } else if (message.role === "tool") {
          role = "tool";
        } else {
          role = "user"; // Default to user if role is not recognized
        }

        const content = [];
        if (typeof message.content === "string") {
          content.push({
            type: "text",
            text: message.content,
          });
        } else if (Array.isArray(message.content)) {
          content.push(
            ...message.content.map((c) => {
              if (c.type === "text") {
                return {
                  type: "text",
                  text: c.text,
                };
              }
              if (c.type === "image_url") {
                return {
                  type: "image_url",
                  image_url: {
                    url: c.image_url.url,
                  },
                };
              }
              return c;
            })
          );
        }

        // 修复：正确处理工具调用的 arguments
        const tool_calls = Array.isArray(message.tool_calls)
          ? message.tool_calls.map((toolCall) => {
              return {
                id:
                  toolCall.id ||
                  `call_${Math.random().toString(36).substring(2, 15)}`,
                type: "function",
                function: {
                  name: toolCall.function.name,
                  // 修复：确保 arguments 是字符串格式
                  arguments: typeof toolCall.function.arguments === 'string' 
                    ? toolCall.function.arguments 
                    : JSON.stringify(toolCall.function.arguments || {}),
                },
              };
            })
          : undefined;

        const tool_call_id = message.tool_call_id;

        const requestMessage: Record<string, any> = {
          role,
          content: content.length > 0 ? content : undefined,
        };

        if (tool_calls) {
          requestMessage.tool_calls = tool_calls;
        }

        if (tool_call_id) {
          requestMessage.tool_call_id = tool_call_id;
        }

        if (message.name) {
          requestMessage.name = message.name;
        }

        return requestMessage;
      }
    );

    const tools = request.tools?.map((tool) => {
      return {
        type: tool.type,
        function: {
          name: tool.function.name,
          description: tool.function.description,
          parameters: tool.function.parameters,
        },
      };
    });

    const body: Record<string, any> = {
      messages,
      model: request.model,
      stream: request.stream,
    };

    if (request.max_tokens) {
      body.max_tokens = request.max_tokens;
    }
    if (request.temperature) {
      body.temperature = request.temperature;
    }
    if (request.tool_choice) {
      body.tool_choice = request.tool_choice;
    }
    if (tools?.length) {
      body.tools = tools;
    }

    return {
      body,
      config: {
        url: new URL(provider.baseUrl),
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${provider.apiKey}`,
        },
      },
    };
  }

  async transformResponseOut(response: Response): Promise<Response> {
    if (response.headers.get("Content-Type")?.includes("application/json")) {
      const jsonResponse: any = await response.json();
      
      // 修复：正确处理 OpenAI 返回的工具调用
      const tool_calls = jsonResponse.choices[0]?.message?.tool_calls?.map((toolCall: any) => ({
        id: toolCall.id,
        type: toolCall.type,
        function: {
          name: toolCall.function.name,
          // 修复：OpenAI 返回的 arguments 已经是字符串，不需要再次 stringify
          arguments: toolCall.function.arguments || "{}",
        },
      })) || [];

      const res = {
        id: jsonResponse.id,
        choices: [
          {
            finish_reason: jsonResponse.choices[0]?.finish_reason || null,
            index: jsonResponse.choices[0]?.index || 0,
            message: {
              content: jsonResponse.choices[0]?.message?.content || null,
              role: jsonResponse.choices[0]?.message?.role || "assistant",
              tool_calls: tool_calls.length > 0 ? tool_calls : undefined,
            },
          },
        ],
        created: jsonResponse.created,
        model: jsonResponse.model,
        object: jsonResponse.object,
        usage: {
          completion_tokens: jsonResponse.usage?.completion_tokens,
          prompt_tokens: jsonResponse.usage?.prompt_tokens,
          total_tokens: jsonResponse.usage?.total_tokens,
        },
      };
      return new Response(JSON.stringify(res), {
        status: response.status,
        statusText: response.statusText,
        headers: response.headers,
      });
    } else if (response.headers.get("Content-Type")?.includes("stream")) {
      if (!response.body) {
        return response;
      }

      const decoder = new TextDecoder();
      const encoder = new TextEncoder();

      const processLine = (
        line: string,
        controller: ReadableStreamDefaultController
      ) => {
        if (line.startsWith("data: ")) {
          const chunkStr = line.slice(6).trim();
          if (chunkStr === "[DONE]") {
            controller.enqueue(encoder.encode(`data: [DONE]\n\n`));
            return;
          }
          if (chunkStr) {
            log("openai stream chunk:", chunkStr);
            try {
              const chunk = JSON.parse(chunkStr);
              
              // 修复：正确处理流式响应中的工具调用
              const tool_calls = chunk.choices[0]?.delta?.tool_calls?.map((toolCall: any) => ({
                index: toolCall.index, // 流式响应中需要包含 index
                id: toolCall.id,
                type: toolCall.type,
                function: {
                  name: toolCall.function?.name,
                  // 修复：流式响应中的 arguments 处理
                  arguments: toolCall.function?.arguments || "",
                },
              })) || undefined;

              const res = {
                id: chunk.id,
                object: chunk.object,
                created: chunk.created,
                model: chunk.model,
                choices: [
                  {
                    index: chunk.choices[0]?.index || 0,
                    delta: {
                      role: chunk.choices[0]?.delta?.role,
                      content: chunk.choices[0]?.delta?.content,
                      tool_calls: tool_calls,
                    },
                    finish_reason: chunk.choices[0]?.finish_reason || null,
                  },
                ],
                usage: chunk.usage ? {
                  completion_tokens: chunk.usage?.completion_tokens,
                  prompt_tokens: chunk.usage?.prompt_tokens,
                  total_tokens: chunk.usage?.total_tokens,
                } : undefined,
              };

              controller.enqueue(
                encoder.encode(`data: ${JSON.stringify(res)}\n\n`)
              );
            } catch (error: any) {
              log("Error parsing OpenAI stream chunk", chunkStr, error.message);
            }
          }
        }
      };

      const stream = new ReadableStream({
        async start(controller) {
          const reader = response.body!.getReader();
          let buffer = "";
          try {
            while (true) {
              const { done, value } = await reader.read();
              if (done) {
                if (buffer) {
                  processLine(buffer, controller);
                }
                break;
              }

              buffer += decoder.decode(value, { stream: true });
              const lines = buffer.split("\n");

              buffer = lines.pop() || "";

              for (const line of lines) {
                processLine(line, controller);
              }
            }
          } catch (error) {
            controller.error(error);
          } finally {
            controller.close();
          }
       },
      });

      return new Response(stream, {
        status: response.status,
        statusText: response.statusText,
        headers: response.headers,
      });
    }
    return response;
  }
}