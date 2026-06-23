// farmingSystem.js — Plants and harvests crops near the base for a
// sustainable, low-risk food source instead of relying on hunting
// animals (which requires combat/chasing and can fail or be dangerous).
const { Vec3 } = require('vec3');

const CROP_DATA = {
  wheat_seeds:   { crop: 'wheat',    mature: 7, soil: 'farmland' },
  carrot:        { crop: 'carrots',  mature: 7, soil: 'farmland' },
  potato:        { crop: 'potatoes', mature: 7, soil: 'farmland' },
  beetroot_seeds:{ crop: 'beetroots', mature: 3, soil: 'farmland' },
};

class FarmingSystem {
  constructor(bot, inventory, navigation, memory) {
    this.bot        = bot;
    this.inventory  = inventory;
    this.navigation = navigation;
    this.memory     = memory;
    this._farmPlots = []; // [{x,y,z}] tilled farmland positions we planted
    console.log('[Farming] System initialised');
  }

  hasFarm() { return this._farmPlots.length > 0; }
  farmPlotCount() { return this._farmPlots.length; }

  /**
   * Till a small plot next to the base and plant whatever seeds we have.
   * Needs: a hoe (wooden is fine), seeds, and to be near water for
   * farmland to stay hydrated (checked loosely — doesn't block planting
   * if water isn't found, just prefers spots that have it).
   */
  async establishFarm(centerPos, size) {
    size = size || 5; // 5x5 plot
    if (!this.inventory.has('wooden_hoe') && !this.inventory.has('stone_hoe') &&
        !this.inventory.has('iron_hoe')) {
      console.log('[Farming] No hoe available — crafting one first');
      return false;
    }

    const seedType = this._bestAvailableSeed();
    if (!seedType) {
      console.log('[Farming] No seeds/plantable items in inventory');
      return false;
    }

    const hoe = this.inventory.getItem('wooden_hoe') ||
                this.inventory.getItem('stone_hoe') ||
                this.inventory.getItem('iron_hoe');

    // Find a flat, open area near the base to till
    const origin = await this._findFarmSpot(centerPos, size);
    if (!origin) {
      console.log('[Farming] Could not find a flat open spot for a farm');
      return false;
    }

    console.log('[Farming] Tilling ' + size + 'x' + size + ' plot at ' +
      origin.x + ',' + origin.y + ',' + origin.z);

    let tilled = 0;
    for (let x = 0; x < size; x++) {
      for (let z = 0; z < size; z++) {
        const pos = origin.offset(x, 0, z);
        const ok = await this._tillAndPlant(pos, hoe, seedType);
        if (ok) tilled++;
      }
    }

    console.log('[Farming] Farm established — ' + tilled + '/' + (size*size) + ' plots planted');
    return tilled > 0;
  }

  _bestAvailableSeed() {
    for (const seed of Object.keys(CROP_DATA)) {
      if (this.inventory.count(seed) >= 4) return seed;
    }
    // Even a single seed/potato/carrot is enough to start — they
    // multiply when harvested and replanted.
    for (const seed of Object.keys(CROP_DATA)) {
      if (this.inventory.has(seed)) return seed;
    }
    return null;
  }

  async _findFarmSpot(centerPos, size) {
    // Scan a small spiral around the base for flat grass/dirt ground
    // with no obstructions above, away from the house footprint itself.
    for (let r = 6; r <= 20; r += 3) {
      for (let angle = 0; angle < 360; angle += 45) {
        const rad = angle * Math.PI / 180;
        const dx = Math.round(Math.cos(rad) * r);
        const dz = Math.round(Math.sin(rad) * r);
        const candidate = centerPos.offset(dx, 0, dz);

        let allClear = true;
        for (let x = 0; x < size && allClear; x++) {
          for (let z = 0; z < size && allClear; z++) {
            const checkPos = candidate.offset(x, 0, z);
            const ground = this.bot.blockAt(checkPos.offset(0, -1, 0));
            const here   = this.bot.blockAt(checkPos);
            if (!ground || !['grass_block','dirt','farmland'].includes(ground.name)) {
              allClear = false;
            }
            if (here && here.name !== 'air') allClear = false;
          }
        }
        if (allClear) return candidate;
      }
    }
    return null;
  }

  async _tillAndPlant(pos, hoe, seedType) {
    try {
      const ground = this.bot.blockAt(pos.offset(0, -1, 0));
      if (!ground) return false;

      if (ground.name === 'grass_block' || ground.name === 'dirt') {
        await this.navigation.moveTo(pos, 3);
        await this.bot.equip(hoe, 'hand');
        await this.bot.activateBlock(ground);
        await this._sleep(150);
      }

      const tilled = this.bot.blockAt(pos.offset(0, -1, 0));
      if (!tilled || tilled.name !== 'farmland') return false;

      const seedItem = this.inventory.getItem(seedType);
      if (!seedItem) return false;

      await this.bot.equip(seedItem, 'hand');
      await this.bot.placeBlock(tilled, new Vec3(0, 1, 0));
      this._farmPlots.push({ x: pos.x, y: pos.y, z: pos.z, seedType });
      return true;
    } catch(e) {
      return false;
    }
  }

  /**
   * Walk the known farm plots, harvest anything mature, and replant.
   * Returns the count of crops harvested.
   */
  async harvestFarm() {
    if (!this._farmPlots.length) return 0;
    let harvested = 0;

    for (const plot of this._farmPlots) {
      const pos = new Vec3(plot.x, plot.y, plot.z);
      const cropBlock = this.bot.blockAt(pos);
      if (!cropBlock) continue;

      const data = Object.values(CROP_DATA).find(c => c.crop === cropBlock.name);
      if (!data) continue;

      const isMature = cropBlock.metadata >= data.mature;
      if (!isMature) continue;

      try {
        await this.navigation.moveTo(pos, 2);
        await this.bot.dig(cropBlock);
        harvested++;
        // Replant immediately if we picked up seeds
        const seedItem = this.inventory.getItem(plot.seedType);
        const farmland = this.bot.blockAt(pos.offset(0, -1, 0));
        if (seedItem && farmland && farmland.name === 'farmland') {
          await this.bot.equip(seedItem, 'hand');
          await this.bot.placeBlock(farmland, new Vec3(0, 1, 0));
        }
      } catch(e) { /* skip this plot, try next */ }
    }

    if (harvested > 0) console.log('[Farming] Harvested ' + harvested + ' crops');
    return harvested;
  }

  _sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
}

module.exports = FarmingSystem;
