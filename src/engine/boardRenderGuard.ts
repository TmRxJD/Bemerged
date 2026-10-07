import type { BemergedHeadlessAction, BemergedHeadlessState } from './headlessEnv'

type BoardRenderGuardInput = {
  state: BemergedHeadlessState
  validActions?: BemergedHeadlessAction[]
  context?: string
}

function getBoardDimensions(board: number[][]): { rows: number; cols: number } {
  const rows = board.length
  const cols = rows > 0 && Array.isArray(board[0]) ? board[0].length : 0
  return { rows, cols }
}

export function assertHeadlessBoardRendered(input: BoardRenderGuardInput): void {
  const { state, validActions, context } = input
  const label = context ? ` (${context})` : ''
  const board = Array.isArray(state.board) ? state.board : []
  const { rows, cols } = getBoardDimensions(board)

  if (rows <= 0 || cols <= 0) {
    throw new Error(`Board failed to render${label}: invalid dimensions ${rows}x${cols}.`)
  }

  let nonZeroCells = 0
  for (const row of board) {
    if (!Array.isArray(row) || row.length !== cols) {
      throw new Error(`Board failed to render${label}: inconsistent row dimensions.`)
    }
    for (const cell of row) {
      if ((Number(cell) || 0) > 0) {
        nonZeroCells += 1
      }
    }
  }

  if (nonZeroCells <= 0) {
    throw new Error(`Board failed to render${label}: no tokens present on board.`)
  }

  if (Array.isArray(validActions) && validActions.length <= 0) {
    throw new Error(`Board rendered but produced no valid actions${label}.`)
  }
}
