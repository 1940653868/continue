import { createAsyncThunk, unwrapResult } from "@reduxjs/toolkit";
import { JSONContent } from "@tiptap/core";
import { InputModifiers } from "core";
import { constructMessages } from "core/llm/constructMessages";
import posthog from "posthog-js";
import { v4 as uuidv4 } from "uuid";
import { selectDefaultModel } from "../slices/configSlice";
import {
  submitEditorAndInitAtIndex,
  updateHistoryItemAtIndex,
} from "../slices/sessionSlice";
import { ThunkApiType } from "../store";
import { gatherContext } from "./gatherContext";
import { resetStateForNewMessage } from "./resetStateForNewMessage";
import { streamNormalInput } from "./streamNormalInput";
import { streamThunkWrapper } from "./streamThunkWrapper";
import { updateFileSymbolsFromFiles } from "./updateFileSymbols";

export const streamResponseThunk = createAsyncThunk<
  void,
  {
    editorState: JSONContent;
    modifiers: InputModifiers;
    index?: number;
    promptPreamble?: string;
  },
  ThunkApiType
>(
  "chat/streamResponse",
  async (
    { editorState, modifiers, index, promptPreamble },
    { dispatch, extra, getState },
  ) => {
    await dispatch(
      streamThunkWrapper(async () => {
        const state = getState();
        const defaultModel = selectDefaultModel(state);
        const slashCommands = state.config.config.slashCommands || [];
        const inputIndex = index ?? state.session.history.length; // Either given index or concat to end

        if (!defaultModel) {
          throw new Error("No chat model selected");
        }

        dispatch(
          submitEditorAndInitAtIndex({ index: inputIndex, editorState }),
        );
        resetStateForNewMessage();

        const result = await dispatch(
          gatherContext({
            editorState,
            modifiers,
            promptPreamble,
          }),
        );
        const {
          selectedContextItems,
          selectedCode,
          content,
          slashCommandWithInput,
        } = unwrapResult(result);

        // symbols for both context items AND selected codeblocks
        const filesForSymbols = [
          ...selectedContextItems
            .filter((item) => item.uri?.type === "file" && item?.uri?.value)
            .map((item) => item.uri!.value),
          ...selectedCode.map((rif) => rif.filepath),
        ];
        dispatch(updateFileSymbolsFromFiles(filesForSymbols));

        dispatch(
          updateHistoryItemAtIndex({
            index: inputIndex,
            updates: {
              message: {
                role: "user",
                content,
                id: uuidv4(),
              },
              contextItems: selectedContextItems,
            },
          }),
        );

        // Construct messages from updated history
        const updatedHistory = getState().session.history;
        const messages = constructMessages([...updatedHistory]);

        posthog.capture("step run", {
          step_name: "User Input",
          params: {},
        });
        posthog.capture("userInput", {});

        // Determine if the input is a slash command
        let commandAndInput = getSlashCommandForInput(content, slashCommands);

        if (!commandAndInput) {
          unwrapResult(await dispatch(streamNormalInput({ messages })));
        } else {
          const [slashCommand, commandInput] = commandAndInput;

          posthog.capture("step run", {
            step_name: slashCommand.name,
            params: {},
          });

          // TODO - handle non-legacy slash commands, update messages if relevant
          // Pass around isFromConfigTs
          unwrapResult(
            await dispatch(
              streamNormalInput({
                messages,
                legacySlashCommandData: {
                  command: slashCommand,
                  contextItems: selectedContextItems,
                  historyIndex: inputIndex,
                  input: commandInput,
                  selectedCode,
                },
              }),
            ),
          );
        }
      }),
    );
  },
);
