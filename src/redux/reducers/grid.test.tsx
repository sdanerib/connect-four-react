import * as fc from 'fast-check';
import { emptyGrid, playToken, checkLastMoveOn } from './grid';
import { Player } from '../../models/player';

describe('emptyGrid', () => {
  it('Should generate grids with the right dimensions', () =>
    fc.assert(
      fc.property(fc.nat(50), fc.nat(50), (width, height) => {
        const grid = emptyGrid(width, height);
        return grid.length === height && grid.every(row => row.length === width);
      })
    ));
  it('Should generate empty grids', () =>
    fc.assert(
      fc.property(fc.nat(50), fc.nat(50), (width, height) => {
        const grid = emptyGrid(width, height);
        return grid.every(row => row.every(cell => cell === Player.None));
      })
    ));
});

const GridWidth = 7;
const GridHeight = 6;
const GridVictory = 4;
const playerArb = fc.constantFrom(Player.PlayerA, Player.PlayerB);
const gridArb = fc.genericTuple([...Array(GridWidth)].map(_ => fc.array(playerArb, 0, GridHeight))).map(gridSchema => {
  const grid = emptyGrid(GridWidth, GridHeight);
  for (let i = 0; i !== gridSchema.length; ++i)
    for (let j = 0; j !== gridSchema[i].length; ++j) grid[GridHeight - j - 1][i] = gridSchema[i][j];
  return grid;
});
const playOnGridArb = fc
  .tuple(gridArb, fc.nat())
  .map(([grid, seed]) => {
    const playableColumns = grid[0].map((c, idx) => (c === Player.None ? idx : -1)).filter(id => id >= 0);
    return { grid, seed, playableColumns };
  })
  .filter(({ playableColumns }) => playableColumns.length > 0)
  .map(({ grid, seed, playableColumns }) => {
    // makes use of a seed generated by fast-check and not a Math.random
    // in order to be reproducible
    const selectedColumn = playableColumns[seed % playableColumns.length];
    return { grid, selectedColumn };
  });
const playOnFullColumnGridArb = fc.tuple(gridArb, fc.nat(GridWidth - 1)).map(([grid, selectedColumn]) => {
  const clonedGrid = grid.map(row => row.slice());
  for (let rowIdx = 0; rowIdx !== clonedGrid.length && clonedGrid[rowIdx][selectedColumn] === Player.None; ++rowIdx) {
    clonedGrid[rowIdx][selectedColumn] = Player.PlayerA;
  }
  return { grid: clonedGrid, selectedColumn };
});

describe('playToken', () => {
  it('Should put the token on top of the column', () =>
    fc.assert(
      fc.property(playOnGridArb, playerArb, ({ grid, selectedColumn }, player) => {
        const nextGrid = playToken(grid, selectedColumn, player);
        return nextGrid.map(row => row[selectedColumn]).find(c => c !== Player.None) === player;
      })
    ));
  it('Should add a single token in the grid', () =>
    fc.assert(
      fc.property(playOnGridArb, playerArb, ({ grid, selectedColumn }, player) => {
        const nextGrid = playToken(grid, selectedColumn, player);
        let numDiffs = 0;
        for (let j = 0; j !== grid.length; ++j)
          for (let i = 0; i !== grid[j].length; ++i) if (grid[j][i] !== nextGrid[j][i]) ++numDiffs;
        return numDiffs === 1;
      })
    ));
  it('Should throw on non playable column', () =>
    fc.assert(
      fc.property(playOnFullColumnGridArb, playerArb, ({ grid, selectedColumn }, player) => {
        expect(() => playToken(grid, selectedColumn, player)).toThrow();
      })
    ));
  it('Should not alter existing grid', () =>
    fc.assert(
      fc.property(playOnGridArb, playerArb, ({ grid, selectedColumn }, player) => {
        const clonedGrid = grid.map(row => row.slice());
        playToken(grid, selectedColumn, player);
        expect(grid).toEqual(clonedGrid);
      })
    ));
});

const computeNextRow = (grid: Player[][], col: number) => {
  // compute the index of the row corresponding to the next token in col
  const lastInColumn = grid.findIndex(row => row[col] !== Player.None);
  return lastInColumn === -1 ? grid.length - 1 : lastInColumn - 1;
};
const replaceOrFillForPlayer = (grid: Player[][], player: Player, row: number, col: number) => {
  // fill [row][col] with selected player
  // while keeping a valid connect four grid (ie also fill the hole below [row][col] if necessary)
  if (grid[row][col] === Player.None) {
    for (let j = row; j !== grid.length && grid[j][col] === Player.None; ++j) {
      grid[row][col] = player;
    }
  } else {
    grid[row][col] = player;
  }
  return grid;
};
const lineVictoryPlayOnGridArb = fc
  .tuple(playOnGridArb, playerArb, fc.integer(-GridVictory + 1, 0))
  .filter(
    ([{ grid, selectedColumn }, _player, offset]) =>
      selectedColumn + offset >= 0 && selectedColumn + offset + GridVictory <= grid[0].length
  )
  .map(([{ grid, selectedColumn }, player, offset]) => {
    const clonedGrid = grid.map(row => row.slice());
    const selectedRow = computeNextRow(grid, selectedColumn);
    for (let idx = 0; idx !== GridVictory; ++idx) {
      const col = selectedColumn + offset + idx;
      if (col === selectedColumn) continue;
      replaceOrFillForPlayer(clonedGrid, player, selectedRow, col);
    }
    return { grid: clonedGrid, selectedColumn, player };
  });
const columnVictoryPlayOnGridArb = fc.tuple(playOnGridArb, playerArb).map(([{ grid, selectedColumn }, player]) => {
  const clonedGrid = grid.map(row => row.slice());
  const selectedRow = computeNextRow(grid, selectedColumn);
  if (grid.length - selectedRow >= GridVictory) {
    for (let idx = 1; idx !== GridVictory; ++idx) clonedGrid[selectedRow + idx][selectedColumn] = player;
  } else {
    for (let idx = 1; idx !== GridVictory; ++idx) clonedGrid[clonedGrid.length - idx][selectedColumn] = player;
  }
  return { grid: clonedGrid, selectedColumn, player };
});
const topLeftDiagonalVictoryPlayOnGridArb = fc
  .tuple(playOnGridArb, playerArb, fc.integer(-GridVictory + 1, 0))
  .filter(([{ grid, selectedColumn }, _player, offset]) => {
    const selectedRow = computeNextRow(grid, selectedColumn);
    return (
      selectedColumn + offset >= 0 &&
      selectedColumn + offset + GridVictory <= grid[0].length &&
      selectedRow + offset >= 0 &&
      selectedRow + offset + GridVictory <= grid.length
    );
  })
  .map(([{ grid, selectedColumn }, player, offset]) => {
    const clonedGrid = grid.map(row => row.slice());
    const selectedRow = computeNextRow(grid, selectedColumn);
    for (let idx = 0; idx !== GridVictory; ++idx) {
      const row = selectedRow + offset + idx;
      const col = selectedColumn + offset + idx;
      if (col === selectedColumn) continue;
      replaceOrFillForPlayer(clonedGrid, player, row, col);
    }
    return { grid: clonedGrid, selectedColumn, player };
  });
const topRightDiagonalVictoryPlayOnGridArb = fc
  .tuple(playOnGridArb, playerArb, fc.integer(-GridVictory + 1, 0))
  .filter(([{ grid, selectedColumn }, _player, offset]) => {
    const selectedRow = computeNextRow(grid, selectedColumn);
    return (
      selectedColumn + offset >= 0 &&
      selectedColumn + offset + GridVictory <= grid[0].length &&
      selectedRow - offset - GridVictory > 0 &&
      selectedRow - offset < grid.length
    );
  })
  .map(([{ grid, selectedColumn }, player, offset]) => {
    const clonedGrid = grid.map(row => row.slice());
    const selectedRow = computeNextRow(grid, selectedColumn);
    for (let idx = 0; idx !== GridVictory; ++idx) {
      const row = selectedRow - offset - idx;
      const col = selectedColumn + offset + idx;
      if (col === selectedColumn) continue;
      replaceOrFillForPlayer(clonedGrid, player, row, col);
    }
    return { grid: clonedGrid, selectedColumn, player };
  });
const noVictoryPlayOnGridArb = fc
  .tuple(
    playOnGridArb,
    playerArb,
    fc.integer(-GridVictory + 2, -1),
    fc.integer(-GridVictory + 2, -1),
    fc.integer(-GridVictory + 2, -1),
    fc.integer(-GridVictory + 2, -1)
  )
  .map(([{ grid, selectedColumn }, player, offsetLine, offsetCol, offsetTL, offsetTR]) => {
    const otherPlayer = player === Player.PlayerA ? Player.PlayerB : Player.PlayerA;
    const clonedGrid = grid.map(row => row.slice());
    const selectedRow = computeNextRow(grid, selectedColumn);
    const updateGrid = (row: number, col: number) => {
      if (row < 0 || row >= clonedGrid.length) return;
      if (col < 0 || col >= clonedGrid[0].length) return;
      if (clonedGrid[row][col] === player) {
        clonedGrid[row][col] = otherPlayer;
      }
    };
    // no line will be possible
    updateGrid(selectedRow, selectedColumn + offsetLine);
    updateGrid(selectedRow, selectedColumn + offsetLine + GridVictory);
    // no column will be possible
    updateGrid(selectedRow - offsetCol, selectedColumn);
    // no top-left diagonal possible
    updateGrid(selectedRow + offsetLine, selectedColumn + offsetLine);
    updateGrid(selectedRow + offsetLine + GridVictory, selectedColumn + offsetLine + GridVictory);
    // no top-right diagonal possible
    updateGrid(selectedRow - offsetLine, selectedColumn + offsetLine);
    updateGrid(selectedRow - offsetLine - GridVictory, selectedColumn + offsetLine + GridVictory);
    return { grid: clonedGrid, selectedColumn, player };
  });
describe('checkLastMoveOn', () => {
  it('Should detect victory when ending line', () =>
    fc.assert(
      fc.property(lineVictoryPlayOnGridArb, ({ grid, selectedColumn, player }) => {
        const nextGrid = playToken(grid, selectedColumn, player);
        return checkLastMoveOn(nextGrid, selectedColumn, GridVictory);
      })
    ));
  it('Should detect victory when ending column', () =>
    fc.assert(
      fc.property(columnVictoryPlayOnGridArb, ({ grid, selectedColumn, player }) => {
        const nextGrid = playToken(grid, selectedColumn, player);
        return checkLastMoveOn(nextGrid, selectedColumn, GridVictory);
      })
    ));
  it('Should detect victory when ending top-left diagonal', () =>
    fc.assert(
      fc.property(topLeftDiagonalVictoryPlayOnGridArb, ({ grid, selectedColumn, player }) => {
        const nextGrid = playToken(grid, selectedColumn, player);
        return checkLastMoveOn(nextGrid, selectedColumn, GridVictory);
      })
    ));
  it('Should detect victory when ending top-right diagonal', () =>
    fc.assert(
      fc.property(topRightDiagonalVictoryPlayOnGridArb, ({ grid, selectedColumn, player }) => {
        const nextGrid = playToken(grid, selectedColumn, player);
        return checkLastMoveOn(nextGrid, selectedColumn, GridVictory);
      })
    ));
  it('Should not detect victory when no victory', () =>
    fc.assert(
      fc.property(noVictoryPlayOnGridArb, ({ grid, selectedColumn, player }) => {
        const nextGrid = playToken(grid, selectedColumn, player);
        return !checkLastMoveOn(nextGrid, selectedColumn, GridVictory);
      })
    ));
});
