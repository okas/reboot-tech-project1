import { GameTile } from "./game-tile.js";
import { rangeGenerator } from "./utilities.js";
import { MatchInfo } from "./match-info.js";
import { ComboMatchInfo } from "./combo-match-info.js";
import { BoardWalker } from "./board-walker.js";

export class GameArena {
  /** @type {string} */
  #canvasId;
  /** @type {number} */
  #rows;
  /** @type {number} */
  #cols;

  /** @type {number} */
  #timerId;
  /** @type {number} */
  #timerInterval;

  /** @type {number} */
  #badSwapTimeout;

  /** @type {HTMLElement} */
  #elemCanvas;

  /** @type {HTMLCollection} */
  #elemTiles;
  /** @type {GameTile} */
  #elemPickedTile;
  /** @type {GameTile} */
  #elemTargetTile;

  #walker;

  /** @type {Map<string, [Function, Function]>} */
  #matchSeekHelpersMap;

  constructor({
    canvasId = "canvasId",
    rows = 7,
    cols = 7,
    badSwapTimeout = 500,
    timerInterval = 200,
  }) {
    this.#canvasId = canvasId;
    this.#timerInterval = timerInterval;
    this.#badSwapTimeout = badSwapTimeout;

    this.#rows = rows;
    this.#cols = cols;
    this.#timerId = null;

    this.#initDOM();
    this.#resetCanvas();
    this.#resetCanvasLayout();

    this.#walker = new BoardWalker(rows, cols);

    this.#setupMatchDirectionalActions();
  }

  #initDOM() {
    this.#elemCanvas = document.getElementById("game-canvas");
  }

  #resetCanvas() {
    this.#resetCanvasLayout();
    this.#elemCanvas.replaceChildren(...this.#createBoard());
    this.#elemTiles = this.#elemCanvas.children;
    this.#elemTiles.indexOf = Array.prototype.indexOf;
  }

  #resetCanvasLayout() {
    const { gridTemplateColumns } = window.getComputedStyle(this.#elemCanvas);
    const extractedColWidth = /\d+.?\d*px/i.exec(gridTemplateColumns)[0];
    const newValue = `repeat(${this.#cols}, ${extractedColWidth})`;

    this.#elemCanvas.style.gridTemplateColumns = newValue;
  }

  *#createBoard() {
    for (const k of rangeGenerator(this.#rows * this.#cols, 1)) {
      yield this.#createTile(this.#getRandomTileKey(), k);
    }
  }

  #getRandomTileKey() {
    return Math.ceil(Math.random() * GameTile.typeCount);
  }

  #createTile(tileKey, id) {
    const tile = new GameTile({ id, type: tileKey, worth: 1, leverage: 1.25 });
    tile.onclick = this.#tileClickHandler.bind(this);

    return tile;
  }

  #setupMatchDirectionalActions() {
    this.#matchSeekHelpersMap = new Map([
      [
        "left",
        [
          this.#walker.detectEdgeLeft.bind(this.#walker),
          this.#walker.getIndexToLeft.bind(this.#walker),
        ],
      ],
      [
        "up",
        [
          this.#walker.detectEdgeUp.bind(this.#walker),
          this.#walker.getIndexToUp.bind(this.#walker),
        ],
      ],
      [
        "right",
        [
          this.#walker.detectEdgeRight.bind(this.#walker),
          this.#walker.getIndexToRight.bind(this.#walker),
        ],
      ],
      [
        "down",
        [
          this.#walker.detectEdgeDown.bind(this.#walker),
          this.#walker.getIndexToDown.bind(this.#walker),
        ],
      ],
    ]);
  }

  /**
   * @param  {Event & {target: GameTile}} {clickedTile}
   */
  #tileClickHandler({ target: clickedTile }) {
    const intendedSwapDirection = this.#manageAndValidateSelection(clickedTile);
    console.debug(intendedSwapDirection);

    if (!intendedSwapDirection) {
      return;
    }

    this.#swapUserSelectedTiles();

    const matchFixture = this.#calculateMatchByUserSelection();
    console.debug(matchFixture);

    if (matchFixture) {
      this.#handleUserSuccessSelection(matchFixture);
    } else {
      this.#handleUserBadSelection();
    }

    // TODO: ensure, that after successful it selection will be reset!
    // At least keep an eye on this nuance!
  }

  /**
   * @param {ComboMatchInfo} matchInfo
   */
  #handleUserSuccessSelection(matchInfo) {
    this.#resetUserSelection();
    this.#hideMatch(matchInfo);
    this.#bubbleMatchToTopEdge(matchInfo);
  }

  /**
   * @param {ComboMatchInfo} matchFixture
   */
  #bubbleMatchToTopEdge(matchFixture) {
    // TODO: this is on possibility to drive how bubbling takes place
    // TODO: and feed the animation.

    // Copy, because bubbling track will be tracked by removing tiles,
    // that are reached it's destination.
    const fixtureRaw = new Set(matchFixture.domSortedTiles);

    while (fixtureRaw.size) {
      fixtureRaw.forEach((tileBubbling) => {
        // TODO: duplicate find of index; swapping does the same!
        const idxMatchTile = this.#elemTiles.indexOf(tileBubbling);

        const tileFalling = this.#tryGetFallingTile(idxMatchTile);

        if (tileFalling) {
          this.#swapTiles(tileBubbling, tileFalling);
        } else {
          fixtureRaw.delete(tileBubbling);
        }
      });
    }
  }

  /**
   * @param {number} indexMatchedTile
   */
  #tryGetFallingTile(indexMatchedTile) {
    if (this.#walker.detectEdgeUp(indexMatchedTile)) {
      return null;
    }
    /** @type {GameTile} */
    const tile = this.#elemTiles.item(
      this.#walker.getIndexToUp(indexMatchedTile)
    );

    return tile.isHidden ? null : tile;
  }

  #handleUserBadSelection() {
    const id = setTimeout(() => {
      clearTimeout(id);
      this.#swapUserSelectedTiles();
      this.#resetUserSelection();
    }, this.#badSwapTimeout);
  }

  /**
   * @param {ComboMatchInfo} matchInfo
   */
  #hideMatch(matchInfo) {
    matchInfo.domSortedTiles.forEach((tile) => tile.setHidden());
  }

  #swapUserSelectedTiles() {
    if (!this.#elemPickedTile || !this.#elemTargetTile) {
      throw new Error(
        "Developer error: tile swapping failed: at least one of the subjected tiles is not set."
      );
    }

    this.#swapTiles(this.#elemPickedTile, this.#elemTargetTile);
  }

  /**
   * Swap provided tiles in DOM.
   * @param {GameTile} tile1
   * @param {GameTile} tile2
   */
  #swapTiles(tile1, tile2) {
    const idxInitialTile1 = this.#elemTiles.indexOf(tile1);

    if (
      tile1.compareDocumentPosition(tile2) & Node.DOCUMENT_POSITION_PRECEDING // left | up ?
    ) {
      tile2.after(tile1);
      this.#elemTiles.item(idxInitialTile1).after(tile2);
    } else {
      tile2.before(tile1);
      this.#elemTiles.item(idxInitialTile1).before(tile2);
    }
  }

  #calculateMatchByUserSelection() {
    const matchInfo1 = this.#detectMatchXY(this.#elemPickedTile);
    const matchInfo2 = this.#detectMatchXY(this.#elemTargetTile);

    return matchInfo1 || matchInfo2
      ? new ComboMatchInfo(matchInfo1, matchInfo2)
      : null;
  }

  /**
   * Conducts analysis by X and Y axes around provided tile.
   * @param {GameTile} tileToAnalyze
   * @returns {MatchInfo} Analyzed tile is included in every or either axe.
   */
  #detectMatchXY(tileToAnalyze) {
    const mInfo = this.#obtainDirectionalMatchInfo(tileToAnalyze);

    const matchX =
      mInfo.left?.length >= 1 || mInfo.right?.length >= 1
        ? [...mInfo.left, tileToAnalyze, ...mInfo.right]
        : null;

    const matchY =
      mInfo.up?.length >= 1 || mInfo.down?.length >= 1
        ? [...mInfo.up, tileToAnalyze, ...mInfo.down]
        : null;

    return matchX?.length >= 3 || matchY?.length >= 3
      ? new MatchInfo(matchX, matchY)
      : null;
  }

  #obtainDirectionalMatchInfo(tileToAnalyze) {
    const pickedTileType = tileToAnalyze.type;
    const idxSeek = this.#elemTiles.indexOf(tileToAnalyze);

    return ["left", "up", "right", "down"].reduce((acc, dir) => {
      acc[dir] = [...this.#seekInDirection(dir, pickedTileType, idxSeek)];
      return acc;
    }, {});
  }

  /**
   * @param {string} direction `left` | `up` |`right` |`down`
   * @param {number} pickedTileType
   * @param {number} seekIndex
   */
  *#seekInDirection(direction, pickedTileType, seekIndex) {
    const [edgeDetectOnDirectionFn, indexToDirectionFn] =
      this.#matchSeekHelpersMap.get(direction);

    // Detect edge on given direction, proceed, if no on the edge yet.
    while (!edgeDetectOnDirectionFn(seekIndex)) {
      // Move seek index to given direction.
      seekIndex = indexToDirectionFn(seekIndex);

      /** @type {GameTile} */
      const testTile = this.#elemTiles[seekIndex];

      // Validate gainst match conditions.
      if (this.#isInMatch(testTile, pickedTileType)) {
        yield testTile;
      } else {
        return;
      }
    }
  }

  /**
   * Validates whether seeked element can be included in match.
   * @param {GameTile} testTile
   * @param {number} pickedTileType
   */
  #isInMatch({ isHidden, type }, pickedTileType) {
    return !isHidden && type === pickedTileType;
  }

  /**
   * @param  {GameTile} clickedTile
   */
  #manageAndValidateSelection(clickedTile) {
    // To guarantee, that only two, consequent tile can be clicked.
    // If not consequent then set update states and "release" the second attempted tile.

    let x;

    if (this.#elemPickedTile === clickedTile) {
      // Click to same element, deactivate use selection.
      this.#resetUserSelection();

      return undefined;
    }

    if (this.#elemPickedTile?.type === clickedTile?.type) {
      // User clicked to the element of same type -- reset "picked" to new tile.
      this.#resetUserSelectionWithNewPicked(clickedTile);

      return undefined;
    }

    if (
      this.#elemPickedTile &&
      !this.#elemTargetTile &&
      (x = this.#isSecondTileOnSide(clickedTile))
    ) {
      // Scenario of 2 consequent tiles: set the states and...
      this.#elemTargetTile = clickedTile;
      this.#elemTargetTile.setTarget();
      // ... start match evaluation

      return x;
    }

    if (!this.#elemPickedTile) {
      // First element will be picked
      this.#elemPickedTile = clickedTile;
      this.#elemPickedTile.setPicked();

      return undefined;
    }

    if (
      this.#elemPickedTile &&
      (this.#elemTargetTile || !(x = this.#isSecondTileOnSide(clickedTile)))
    ) {
      // Wrong 2nd tile clicked OR both already clicked: reset states and set new picked immediately.
      this.#resetUserSelectionWithNewPicked(clickedTile);

      return x;
    }

    return undefined;
  }

  #resetUserSelectionWithNewPicked(pickedTile) {
    this.#resetUserSelection();
    this.#elemPickedTile = pickedTile;
    this.#elemPickedTile.setPicked();
  }

  #resetUserSelection() {
    this.#elemPickedTile?.unSetPicked().unSetTarget();
    this.#elemTargetTile?.unSetPicked().unSetTarget();
    this.#elemPickedTile = this.#elemTargetTile = null;
  }

  /**
   * @param  {GameTile} target
   */
  #isSecondTileOnSide(target) {
    const x = this.#elemTiles.indexOf(target);
    const y = this.#elemTiles.indexOf(this.#elemPickedTile);

    switch (x - y) {
      case -1:
        return "left";
      case -this.#cols:
        return "up";
      case +this.#cols:
        return "down";
      case 1:
        return "right";
    }
  }
}
