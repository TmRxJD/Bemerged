import { BOARD_COLS, BOARD_ROWS, type Cell, type ModuleToken, type Move } from './types'

export type BoardGrid = Array<Array<ModuleToken | null>>

export function cloneBoard(board: BoardGrid): BoardGrid {
  return board.map(row => row.slice())
}

export function areAdjacent(a: Cell, b: Cell): boolean {
  const rowDelta = Math.abs(a.row - b.row)
  const colDelta = Math.abs(a.col - b.col)
  return (rowDelta === 1 && colDelta === 0) || (rowDelta === 0 && colDelta === 1)
}

export function swap(board: BoardGrid, move: Move): void {
  const from = board[move.from.row][move.from.col]
  const to = board[move.to.row][move.to.col]
  board[move.from.row][move.from.col] = to
  board[move.to.row][move.to.col] = from
}

function sameMatchKey(a: ModuleToken | null, b: ModuleToken | null): boolean {
  return Boolean(a && b && a.matchKey === b.matchKey)
}

export function findMatches(board: BoardGrid): Cell[] {
  const marked = new Set<string>()

  for (let row = 0; row < BOARD_ROWS; row += 1) {
    let col = 0
    while (col < BOARD_COLS) {
      const token = board[row][col]
      if (!token) {
        col += 1
        continue
      }

      let end = col + 1
      while (end < BOARD_COLS && sameMatchKey(board[row][end], token)) {
        end += 1
      }

      if (end - col >= 3) {
        for (let cursor = col; cursor < end; cursor += 1) {
          marked.add(`${row},${cursor}`)
        }
      }
      col = end
    }
  }

  for (let col = 0; col < BOARD_COLS; col += 1) {
    let row = 0
    while (row < BOARD_ROWS) {
      const token = board[row][col]
      if (!token) {
        row += 1
        continue
      }

      let end = row + 1
      while (end < BOARD_ROWS && sameMatchKey(board[end][col], token)) {
        end += 1
      }

      if (end - row >= 3) {
        for (let cursor = row; cursor < end; cursor += 1) {
          marked.add(`${cursor},${col}`)
        }
      }
      row = end
    }
  }

  return Array.from(marked).map(item => {
    const [row, col] = item.split(',').map(Number)
    return { row, col }
  })
}

export function clearMatches(board: BoardGrid, matches: Cell[]): ModuleToken[] {
  const removed: ModuleToken[] = []
  for (const match of matches) {
    const token = board[match.row][match.col]
    if (token) removed.push(token)
    board[match.row][match.col] = null
  }
  return removed
}

export function collapse(board: BoardGrid, createToken: () => ModuleToken): void {
  for (let col = 0; col < BOARD_COLS; col += 1) {
    const values: ModuleToken[] = []
    for (let row = BOARD_ROWS - 1; row >= 0; row -= 1) {
      const token = board[row][col]
      if (token) values.push(token)
    }

    while (values.length < BOARD_ROWS) {
      values.push(createToken())
    }

    for (let row = BOARD_ROWS - 1; row >= 0; row -= 1) {
      board[row][col] = values[BOARD_ROWS - 1 - row]
    }
  }
}

export function findAnyValidMove(board: BoardGrid): Move | null {
  const moves = findAllValidMoves(board)
  return moves[0] || null
}

export function findAllValidMoves(board: BoardGrid): Move[] {
  const validMoves: Move[] = []

  for (let row = 0; row < BOARD_ROWS; row += 1) {
    for (let col = 0; col < BOARD_COLS; col += 1) {
      for (let targetRow = row; targetRow < BOARD_ROWS; targetRow += 1) {
        const targetStartCol = targetRow === row ? col + 1 : 0
        for (let targetCol = targetStartCol; targetCol < BOARD_COLS; targetCol += 1) {
          const candidate: Move = {
            from: { row, col },
            to: { row: targetRow, col: targetCol },
          }

          const from = board[candidate.from.row][candidate.from.col]
          const to = board[candidate.to.row][candidate.to.col]
          if (!from || !to || from.matchKey === to.matchKey) continue
          validMoves.push(candidate)
        }
      }
    }
  }

  return validMoves
}

export function createPlayableBoard(createToken: () => ModuleToken): BoardGrid {
  let attempts = 0
  while (attempts < 200) {
    attempts += 1
    const board: BoardGrid = Array.from({ length: BOARD_ROWS }, () => Array.from({ length: BOARD_COLS }, () => createToken()))
    if (findMatches(board).length === 0 && findAnyValidMove(board)) {
      return board
    }
  }

  return Array.from({ length: BOARD_ROWS }, () => Array.from({ length: BOARD_COLS }, () => createToken()))
}
