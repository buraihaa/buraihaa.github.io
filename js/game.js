// Basic configuration
const DEFAULT_ROWS = 10;
const DEFAULT_COLS = 10;
const DEFAULT_MINES = 15;

// Game state
let rows = DEFAULT_ROWS;
let cols = DEFAULT_COLS;
let mines = DEFAULT_MINES;

let board = [];        // 2D array of cell objects
let revealedCount = 0;
let flagsLeft = 0;
let gameOver = false;

// DOM elements
const boardElement = document.getElementById("board");
const minesCountElement = document.getElementById("mines-count");
const flagsCountElement = document.getElementById("flags-count");
const messageElement = document.getElementById("message");
const resetButton = document.getElementById("reset-btn");

// Cell object shape:
// {
//   row, col,
//   hasMine: boolean,
//   adjacentMines: number,
//   isRevealed: boolean,
//   isFlagged: boolean,
//   element: HTMLElement
// }

document.addEventListener("DOMContentLoaded", () => {
  initGame();
  resetButton.addEventListener("click", initGame);
});

// Initialize / reset the game
function initGame() {
  gameOver = false;
  revealedCount = 0;
  flagsLeft = mines;
  messageElement.textContent = "がんばって!";

  board = createBoard(rows, cols, mines);
  updateStats();
  renderBoard();
}

// Create the underlying board data with mines & numbers
function createBoard(rows, cols, mines) {
  const tempBoard = [];

  // Create empty cells
  for (let r = 0; r < rows; r++) {
    const row = [];
    for (let c = 0; c < cols; c++) {
      row.push({
        row: r,
        col: c,
        hasMine: false,
        adjacentMines: 0,
        isRevealed: false,
        isFlagged: false,
        element: null
      });
    }
    tempBoard.push(row);
  }

  // Generate all positions
  const positions = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      positions.push({ row: r, col: c });
    }
  }

  // Shuffle positions (Fisher–Yates)
  for (let i = positions.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [positions[i], positions[j]] = [positions[j], positions[i]];
  }

  // Place mines
  for (let i = 0; i < mines; i++) {
    const { row, col } = positions[i];
    tempBoard[row][col].hasMine = true;
  }

  // Calculate adjacent mine counts
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const cell = tempBoard[r][c];
      if (!cell.hasMine) {
        cell.adjacentMines = countAdjacentMines(tempBoard, r, c);
      }
    }
  }

  return tempBoard;
}

function countAdjacentMines(board, row, col) {
  let count = 0;
  for (let dr = -1; dr <= 1; dr++) {
    for (let dc = -1; dc <= 1; dc++) {
      if (dr === 0 && dc === 0) continue;
      const nr = row + dr;
      const nc = col + dc;
      if (nr >= 0 && nr < rows && nc >= 0 && nc < cols) {
        if (board[nr][nc].hasMine) count++;
      }
    }
  }
  return count;
}

// Render board into the DOM
function renderBoard() {
  boardElement.innerHTML = "";

  // Configure CSS grid size
  boardElement.style.gridTemplateColumns = `repeat(${cols}, 32px)`;
  boardElement.style.gridTemplateRows = `repeat(${rows}, 32px)`;

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const cell = board[r][c];
      const cellEl = document.createElement("button");
      cellEl.classList.add("cell");
      cellEl.setAttribute("data-row", r);
      cellEl.setAttribute("data-col", c);

      // Left click: reveal
      cellEl.addEventListener("click", () => {
        handleLeftClick(cell);
      });

      // Right click: flag
      cellEl.addEventListener("contextmenu", (e) => {
        handleRightClick(e, cell);
      });

      boardElement.appendChild(cellEl);
      cell.element = cellEl;
    }
  }
}

// Handle left click (reveal)
function handleLeftClick(cell) {
  if (gameOver || cell.isRevealed || cell.isFlagged) return;
  revealCell(cell);
}

// Handle right click (flag / unflag)
function handleRightClick(event, cell) {
  event.preventDefault();
  if (gameOver || cell.isRevealed) return;

  if (cell.isFlagged) {
    cell.isFlagged = false;
    flagsLeft++;
    cell.element.classList.remove("flagged");
    cell.element.textContent = "";
  } else {
    if (flagsLeft <= 0) return;
    cell.isFlagged = true;
    flagsLeft--;
    cell.element.classList.add("flagged");
    cell.element.textContent = "🍊";
  }

  updateStats();
}

// Reveal a cell (and flood fill if empty)
function revealCell(cell) {
  if (cell.isRevealed || cell.isFlagged) return;

  cell.isRevealed = true;
  revealedCount++;
  cell.element.classList.add("revealed");
  cell.element.classList.remove("flagged");
  cell.element.textContent = "";

  if (cell.hasMine) {
    cell.element.classList.add("mine");
    cell.element.textContent = "💚";
    gameOver = true;
    revealAllMines();
    messageElement.textContent = "Hehehe, I love you!　ゲーム オーバー　💚❤️💙💛🧡";
    return;
  }

  if (cell.adjacentMines > 0) {
    cell.element.textContent = cell.adjacentMines;
    cell.element.classList.add(`m${cell.adjacentMines}`);
  } else {
    // Flood-fill neighbors
    const neighbors = getNeighbors(cell.row, cell.col);
    neighbors.forEach((neighbor) => {
      if (!neighbor.isRevealed && !neighbor.hasMine) {
        revealCell(neighbor);
      }
    });
  }

  checkWin();
}

// Get valid neighbor cells for a given coordinate
function getNeighbors(row, col) {
  const neighbors = [];

  for (let dr = -1; dr <= 1; dr++) {
    for (let dc = -1; dc <= 1; dc++) {
      if (dr === 0 && dc === 0) continue;
      const nr = row + dr;
      const nc = col + dc;
      if (nr >= 0 && nr < rows && nc >= 0 && nc < cols) {
        neighbors.push(board[nr][nc]);
      }
    }
  }

  return neighbors;
}

// Reveal all mines at game over
function revealAllMines() {
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const cell = board[r][c];
      if (cell.hasMine) {
        cell.element.classList.add("mine", "revealed");
        if (!cell.element.textContent) {
          cell.element.textContent = "💚";
        }
      }
    }
  }
}

// Check win condition
function checkWin() {
  if (gameOver) return;
  const totalCells = rows * cols;
  if (revealedCount === totalCells - mines) {
    gameOver = true;
    messageElement.textContent = "You cleared the minefield! 🎉";
  }
}

// Update UI stats
function updateStats() {
  minesCountElement.textContent = mines;
  flagsCountElement.textContent = flagsLeft;
}
