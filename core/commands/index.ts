import { CustomCommand, SlashCommand, SlashCommandDescription } from "../";
import { renderTemplatedString } from "../promptFiles/v1/renderTemplatedString";
import { renderChatMessage } from "../util/messageContent";

import SlashCommands from "./slash";

export function slashFromCustomCommand(
  customCommand: CustomCommand,
): SlashCommand {
  const commandName = customCommand.name.startsWith("/")
    ? customCommand.name.substring(1)
    : customCommand.name;
  return {
    name: commandName,
    description: customCommand.description ?? "",
    prompt: customCommand.prompt,
    run: async function* ({ input, llm, history, ide, completionOptions }) {
      console.log("SLASH COMMAND RUN", input, prompt, commandName);
      // Remove slash command prefix from input
      let userInput = input;
      if (userInput.startsWith(commandName)) {
        userInput = userInput.substring(commandName.length).trimStart();
      }

      // Render prompt template
      let promptUserInput: string;
      if (customCommand.prompt.includes("{{{ input }}}")) {
        promptUserInput = await renderTemplatedString(
          customCommand.prompt,
          ide.readFile.bind(ide),
          { input: userInput },
        );
      } else {
        promptUserInput = customCommand.prompt + "\n\n" + userInput;
      }

      const messages = [...history];
      // Find the last chat message with this slash command and replace it with the user input
      for (let i = messages.length - 1; i >= 0; i--) {
        const message = messages[i];
        const { role, content } = message;
        if (role !== "user") {
          continue;
        }

        if (
          Array.isArray(content) &&
          content.some(
            (part) => "text" in part && part.text?.startsWith(commandName),
          )
        ) {
          messages[i] = {
            ...message,
            content: content.map((part) => {
              if ("text" in part && part.text.startsWith(commandName)) {
                return { type: "text", text: promptUserInput };
              }
              return part;
            }),
          };
          break;
        } else if (
          typeof content === "string" &&
          content.startsWith(commandName)
        ) {
          messages[i] = { ...message, content: promptUserInput };
          break;
        }
      }

      for await (const chunk of llm.streamChat(
        messages,
        new AbortController().signal,
        completionOptions,
      )) {
        yield renderChatMessage(chunk);
      }
    },
  };
}

export function slashCommandFromDescription(
  desc: SlashCommandDescription,
): SlashCommand | undefined {
  const cmd = SlashCommands.find((cmd) => cmd.name === desc.name);
  if (!cmd) {
    return undefined;
  }
  return {
    ...cmd,
    params: desc.params,
    description: desc.description ?? cmd.description,
  };
}
