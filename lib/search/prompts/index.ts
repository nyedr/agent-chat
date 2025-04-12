import {
  academicSearchResponsePrompt,
  academicSearchRetrieverPrompt,
} from "./academicSearch";
import { webSearchResponsePrompt, webSearchRetrieverPrompt } from "./webSearch";
import {
  wolframAlphaSearchResponsePrompt,
  wolframAlphaSearchRetrieverPrompt,
} from "./wolframAlpha";

const prompts = {
  academicSearchResponsePrompt,
  academicSearchRetrieverPrompt,
  webSearchResponsePrompt,
  webSearchRetrieverPrompt,
  wolframAlphaSearchResponsePrompt,
  wolframAlphaSearchRetrieverPrompt,
};

export default prompts;
