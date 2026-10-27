import type { OdsListResponse } from '../requests/ods-catalog.dto.js';

export interface OdsControllerInterface {
  listOds(): Promise<OdsListResponse>;
}
