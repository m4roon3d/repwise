import { describe, expect, it } from 'vitest';
import {
  DEFAULT_PROFILE,
  exportBackupJson,
  importBackupJson,
  normalizePlan,
  saveApiKey,
  saveProfile,
} from '../services/storage';

describe('Storage, Backup Security & Schema Migration', () => {
  it('never leaks the Gemini API key inside exported backup JSON', () => {
    saveApiKey('AIzaSy-SUPER-SECRET-KEY-12345');
    saveProfile({ ...DEFAULT_PROFILE, age: 49 });

    const exported = exportBackupJson();
    expect(exported).not.toContain('AIzaSy-SUPER-SECRET-KEY-12345');
    const parsed = JSON.parse(exported);
    expect(parsed.profile.age).toBe(49);
    expect(parsed.schemaVersion).toBe(2);
    expect(Array.isArray(parsed.workoutLogs)).toBe(true);
  });

  it('migrates V1 single-week plans (plan.days) into V2 multi-week format (plan.weeks)', () => {
    const v1 = {
      program_title: 'Legacy V1 Plan',
      comeback_strategy: 'Start light',
      days: [{ day_id: 'day_1', day_label: 'Day 1', exercises: [] }],
    };
    const normalized = normalizePlan(v1);
    expect(normalized.weeks).toHaveLength(1);
    expect(normalized.weeks[0].days).toHaveLength(1);
  });

  it('restores profile and plan cleanly from backup JSON', () => {
    const backup = JSON.stringify({
      profile: { ...DEFAULT_PROFILE, equipmentTier: 'home_setup' },
      activePlan: { program_title: 'Restored', days: [{ day_id: 'd1', exercises: [] }] },
      feedbackHistory: [{ rating: 'Just Right' }],
    });
    const restored = importBackupJson(backup);
    expect(restored.profile.equipmentTier).toBe('home_setup');
    expect(restored.activePlan.weeks).toHaveLength(1);
    expect(restored.feedbackHistory).toHaveLength(1);
  });
});
