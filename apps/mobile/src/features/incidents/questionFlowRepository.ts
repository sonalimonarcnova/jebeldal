import { supabase } from '../../lib/supabase';
import {
  processIncidentTextTurnWith,
  selectNextQuestionWith,
  type NextQuestionResult,
  type ProcessedTurn,
} from './questionFlow';

async function invokeQuestionFlowFunction(
  functionName: 'select-next-question' | 'process-incident-turn',
  body: Record<string, unknown>,
): Promise<{ data: unknown; error: { message: string } | null }> {
  const { data, error } = await supabase.functions.invoke(functionName, { body });
  return { data, error };
}

export function selectNextQuestion(revisionId: string): Promise<NextQuestionResult> {
  return selectNextQuestionWith(invokeQuestionFlowFunction, revisionId);
}

export function processIncidentTextTurn(input: {
  revisionId: string;
  clientTurnId: string;
  text: string;
}): Promise<ProcessedTurn> {
  return processIncidentTextTurnWith(invokeQuestionFlowFunction, input);
}
