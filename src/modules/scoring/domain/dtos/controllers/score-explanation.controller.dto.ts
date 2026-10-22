import type {
  ScoreExplanationRequest,
  ScoreExplanationResponse,
} from '../requests/score-explanation.dto.js';

export interface ScoreExplanationControllerInterface {
  getExplanation(
    params: ScoreExplanationRequest,
  ): Promise<ScoreExplanationResponse>;
}
