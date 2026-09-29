import type { InspirationErrorCode } from '../../shared/inspiration'

export class InspirationError extends Error {
  constructor(readonly code: InspirationErrorCode, message: string) {
    super(message)
    this.name = 'InspirationError'
  }
}
