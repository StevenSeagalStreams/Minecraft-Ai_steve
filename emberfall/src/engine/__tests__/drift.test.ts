import { TEST_CONFIG, TEST_EPOCH } from '../../testing/testConfig';
import { assessTimeDrift } from '../drift';

const time = TEST_CONFIG.time;

describe('assessTimeDrift', () => {
  it('treats a normal gap as a tick', () => {
    const drift = assessTimeDrift(TEST_EPOCH, TEST_EPOCH + 250, time);
    expect(drift.kind).toBe('normal');
    expect(drift.tickMs).toBe(250);
    expect(drift.offlineMs).toBe(0);
    expect(drift.suspicious).toBe(false);
  });

  it('clamps a long-but-online gap to maxTickMs', () => {
    const drift = assessTimeDrift(TEST_EPOCH, TEST_EPOCH + 20_000, time);
    expect(drift.kind).toBe('normal');
    expect(drift.tickMs).toBe(time.maxTickMs);
    expect(drift.rawElapsedMs).toBe(20_000);
  });

  it('routes a large forward jump to offline progress', () => {
    const drift = assessTimeDrift(TEST_EPOCH, TEST_EPOCH + 7_200_000, time);
    expect(drift.kind).toBe('forwardJump');
    expect(drift.tickMs).toBe(0);
    expect(drift.offlineMs).toBe(7_200_000);
  });

  it('awards nothing when the clock moves backwards', () => {
    const drift = assessTimeDrift(TEST_EPOCH, TEST_EPOCH - 1_000, time);
    expect(drift.kind).toBe('backward');
    expect(drift.tickMs).toBe(0);
    expect(drift.offlineMs).toBe(0);
    expect(drift.suspicious).toBe(false);
  });

  it('flags a large backward jump as suspicious', () => {
    const drift = assessTimeDrift(TEST_EPOCH, TEST_EPOCH - 86_400_000, time);
    expect(drift.kind).toBe('backward');
    expect(drift.suspicious).toBe(true);
  });

  it('rejects non-finite timestamps', () => {
    const drift = assessTimeDrift(TEST_EPOCH, Number.NaN, time);
    expect(drift.kind).toBe('backward');
    expect(drift.suspicious).toBe(true);
    expect(drift.tickMs).toBe(0);
  });

  it('sits exactly on the forward boundary without jumping', () => {
    const drift = assessTimeDrift(TEST_EPOCH, TEST_EPOCH + time.maxForwardDriftMs, time);
    expect(drift.kind).toBe('normal');
  });
});
