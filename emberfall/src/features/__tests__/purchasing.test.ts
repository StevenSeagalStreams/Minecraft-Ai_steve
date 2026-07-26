import { D, ZERO } from '../../math/decimal';
import { bulkCost } from '../../math/scaling';
import {
  amountOf,
  freshState,
  modifiersOf,
  ownedOf,
  withGenerator,
  withResource,
  withUpgrade,
} from '../../testing/helpers';
import { TEST_CONFIG } from '../../testing/testConfig';
import { BUY_MAX, nextUnitCost, purchaseGenerator, quotePurchase, setAutomationEnabled } from '../idle/generators';
import { canPurchaseUpgrade, purchaseUpgrade, upgradeCost } from '../upgrades/purchase';
import { getRegistry } from '../registry';
import { applyUnlocks } from '../unlocks';

const config = TEST_CONFIG;
const g1Cost = config.generators[0]?.cost;

describe('generator purchasing', () => {
  it('quotes and charges the exact curve price', () => {
    const state = withResource(freshState(), 'gold', '1000');
    const quote = quotePurchase(state, config, 'g1', 3, modifiersOf(state));
    expect(quote?.cost.eq(70)).toBe(true); // 10 + 20 + 40

    const result = purchaseGenerator(state, config, 'g1', 3, modifiersOf(state));
    expect(result.purchased.eq(3)).toBe(true);
    expect(amountOf(result.state, 'gold').eq(930)).toBe(true);
    expect(ownedOf(result.state, 'g1').eq(3)).toBe(true);
  });

  it('tracks lifetime purchases separately from the current count', () => {
    const state = withResource(freshState(), 'gold', '1000');
    const result = purchaseGenerator(state, config, 'g1', 2, modifiersOf(state));
    expect(result.state.generators.g1?.lifetimePurchased.eq(2)).toBe(true);
  });

  it('buys nothing when the player cannot afford one', () => {
    const state = withResource(freshState(), 'gold', '9');
    const result = purchaseGenerator(state, config, 'g1', 1, modifiersOf(state));
    expect(result.purchased.eq(ZERO)).toBe(true);
    expect(result.state).toBe(state);
  });

  it('clamps an over-large request instead of overdrawing', () => {
    const state = withResource(freshState(), 'gold', '100');
    const result = purchaseGenerator(state, config, 'g1', 50, modifiersOf(state));
    // 10 + 20 + 40 = 70 affordable; the fourth would cost 80.
    expect(result.purchased.eq(3)).toBe(true);
    expect(amountOf(result.state, 'gold').gte(ZERO)).toBe(true);
  });

  it('buys the maximum affordable with the BUY_MAX sentinel', () => {
    const state = withResource(freshState(), 'gold', '1e6');
    const result = purchaseGenerator(state, config, 'g1', BUY_MAX, modifiersOf(state));
    expect(result.purchased.gt(ZERO)).toBe(true);
    if (g1Cost !== undefined) {
      const nextOne = bulkCost(g1Cost, result.purchased, D(1));
      expect(amountOf(result.state, 'gold').lt(nextOne)).toBe(true);
    }
  });

  it('refuses to buy a locked generator', () => {
    const state = withResource(freshState(), 'gold', '1e6');
    expect(state.generators.g2?.unlocked).toBe(false);
    const result = purchaseGenerator(state, config, 'g2', 1, modifiersOf(state));
    expect(result.purchased.eq(ZERO)).toBe(true);
  });

  it('ignores unknown generator ids', () => {
    const state = withResource(freshState(), 'gold', '1e6');
    expect(purchaseGenerator(state, config, 'nope', 1, modifiersOf(state)).state).toBe(state);
    expect(quotePurchase(state, config, 'nope', 1, modifiersOf(state))).toBeNull();
  });

  it('applies cost modifiers to both the quote and the charge', () => {
    const base = withResource(freshState(), 'gold', '1000');
    const discounted = withUpgrade(withUpgrade(base, 'boost', 2), 'lockedUpgrade', 1);

    expect(nextUnitCost(base, config, 'g1', modifiersOf(base)).eq(10)).toBe(true);
    expect(nextUnitCost(discounted, config, 'g1', modifiersOf(discounted)).eq(5)).toBe(true);

    const result = purchaseGenerator(discounted, config, 'g1', 1, modifiersOf(discounted));
    expect(amountOf(result.state, 'gold').eq(995)).toBe(true);
  });

  it('lets a discount stretch the max-affordable count further', () => {
    const base = withResource(freshState(), 'gold', '1000');
    const discounted = withUpgrade(withUpgrade(base, 'boost', 2), 'lockedUpgrade', 1);
    const plain = purchaseGenerator(base, config, 'g1', BUY_MAX, modifiersOf(base));
    const cheap = purchaseGenerator(discounted, config, 'g1', BUY_MAX, modifiersOf(discounted));
    expect(cheap.purchased.gt(plain.purchased)).toBe(true);
  });

  it('toggles automation without touching anything else', () => {
    const state = withGenerator(freshState(), 'g1', 4);
    const off = setAutomationEnabled(state, 'g1', false);
    expect(off.generators.g1?.automationEnabled).toBe(false);
    expect(off.generators.g1?.owned.eq(4)).toBe(true);
    expect(setAutomationEnabled(state, 'nope', false)).toBe(state);
  });
});

describe('upgrade purchasing', () => {
  const registry = getRegistry(config);

  it('charges the level-indexed price', () => {
    const state = withResource(freshState(), 'gold', '10000');
    const boost = registry.upgrades.get('boost');
    expect(boost).toBeDefined();
    if (boost === undefined) return;

    expect(upgradeCost(state, boost, modifiersOf(state)).eq(100)).toBe(true);
    const once = purchaseUpgrade(state, config, 'boost', modifiersOf(state)).state;
    expect(upgradeCost(once, boost, modifiersOf(once)).eq(1000)).toBe(true);
    expect(amountOf(once, 'gold').eq(9900)).toBe(true);
  });

  it('stops at max level', () => {
    const state = withUpgrade(withResource(freshState(), 'gold', '1e12'), 'boost', 5);
    const result = purchaseUpgrade(state, config, 'boost', modifiersOf(state));
    expect(result.purchased).toBe(false);
    expect(result.state).toBe(state);
  });

  it('supports an unbounded max level', () => {
    const endless = {
      ...config,
      upgrades: config.upgrades.map((def) =>
        def.id === 'boost' ? { ...def, maxLevel: Number.POSITIVE_INFINITY } : def,
      ),
    };
    // Level 40 costs 100 * 10^40; the balance has to clear that.
    const state = withUpgrade(withResource(freshState(endless), 'gold', '1e50'), 'boost', 40);
    expect(purchaseUpgrade(state, endless, 'boost', modifiersOf(state, endless)).purchased).toBe(
      true,
    );
  });

  it('refuses when the player cannot afford it', () => {
    const state = withResource(freshState(), 'gold', '99');
    expect(purchaseUpgrade(state, config, 'boost', modifiersOf(state)).purchased).toBe(false);
  });

  it('enforces prerequisites and unlock conditions', () => {
    const rich = withResource(freshState(), 'gold', '1e9');
    const locked = registry.upgrades.get('lockedUpgrade');
    expect(locked).toBeDefined();
    if (locked === undefined) return;

    expect(canPurchaseUpgrade(rich, config, locked, modifiersOf(rich))).toBe(false);

    // Meeting the prerequisite is not enough on its own — the unlock pass has
    // to have seen it, which is what the engine runs every tick.
    const met = withUpgrade(rich, 'boost', 2);
    expect(canPurchaseUpgrade(met, config, locked, modifiersOf(met))).toBe(false);

    const ready = applyUnlocks(met, config);
    expect(ready.upgrades.lockedUpgrade?.unlocked).toBe(true);
    expect(canPurchaseUpgrade(ready, config, locked, modifiersOf(ready))).toBe(true);
  });

  it('ignores unknown upgrade ids', () => {
    const state = withResource(freshState(), 'gold', '1e9');
    expect(purchaseUpgrade(state, config, 'nope', modifiersOf(state)).state).toBe(state);
  });

  it('compounds a repeatable multiplier per level', () => {
    const state = withUpgrade(freshState(), 'boost', 3);
    expect(modifiersOf(state).globalProduction.eq(8)).toBe(true);
  });
});
