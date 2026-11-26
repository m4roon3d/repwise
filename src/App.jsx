import React, { useRef, useState } from 'react';
import AssessmentForm from './components/AssessmentForm';
import RoutineView from './components/RoutineView';
import CatalogBrowser from './components/CatalogBrowser';
import SettingsModal from './components/SettingsModal';
import HealthNotice from './components/HealthNotice';
import AskCoach from './components/AskCoach';
import Watermark from './components/Watermark';
import Wordmark from './components/Wordmark';
import Onboarding from './components/Onboarding';
import PlanWhy from './components/PlanWhy';
import ProgressView from './components/ProgressView';
import HealthView from './components/HealthView';
import { latestLabsForProfile } from './services/labs';
import { describeBodyCompForPrompt } from './services/bodyComp';
import { AboutYou, FitnessTest, HealthCheck, InjuryGrid, LabReport, profileCompleteness } from './components/HealthSections';
import { retestDue } from './services/baseline';
import { ChatIcon, CoachIcon, ExercisesIcon, HealthIcon, KeyIcon, ProgressIcon, WorkoutIcon } from './components/Icons';
import {
  appendFeedback,
  loadApiKey,
  loadFeedbackHistory,
  loadHealthAck,
  loadOnboarded,
  loadBodyScans,
  loadLabReports,
  saveLabReports,
  saveBodyScans,
  saveOnboarded,
  listProfiles,
  getActiveProfileId,
  switchProfile,
  createProfile,
  deleteProfile,
  loadCoachChat,
  loadWorkoutLogs,
  saveCoachChat,
  saveWorkoutLogs,
  saveHealthAck,
  loadModel,
  loadPlan,
  loadProfile,
  saveApiKey,
  saveModel,
  savePlan,
  saveProfile,
} from './services/storage';
import { filterSafeExercises } from './services/catalogFilter';
import {
  adaptSingleDay,
  askCoach,
  extractLabReport,
  extractBodyScan,
  analyzeLabReport,
  generateAdaptivePlan,
  resolveSwapConflict,
  carryProgression,
  swapExercise,
} from './services/geminiCoach';
import { summarizeLogsForPrompt } from './services/progress';
import { EXERCISE_MAP } from './services/catalogFilter';

const VALID_GOALS = new Set([
  'general_fitness',
  'rebuild_consistency',
  'strength_hypertrophy',
  'fat_loss_conditioning',
  'mobility_longevity',
]);
const VALID_TIERS = new Set(['commercial_gym', 'apartment_gym', 'home_setup']);
const VALID_LEVELS = new Set(['low', 'moderate', 'high']);
const VALID_EXPERIENCE = new Set(['beginner', 'intermediate', 'advanced']);

/** Each person gets a fresh ProfileApp: remounting on switch reloads all of their state from storage. */
export default function App() {
  const [profileId, setProfileId] = useState(() => getActiveProfileId());
  const go = (id) => {
    if (switchProfile(id)) setProfileId(id);
  };
  return (
    <ProfileApp
      key={profileId}
      profileId={profileId}
      onSwitch={go}
      onAddPerson={() => setProfileId(createProfile(''))}
      onRemovePerson={(id) => {
        deleteProfile(id);
        setProfileId(getActiveProfileId());
      }}
    />
  );
}

function ProfileApp({ profileId, onSwitch, onAddPerson, onRemovePerson }) {
  const [onboarded, setOnboarded] = useState(() => loadOnboarded());
  const people = listProfiles();
  const [tab, setTab] = useState(() => (loadPlan() ? 'routine' : 'assess'));
  const [apiKey, setApiKey] = useState(() => loadApiKey());
  const [model, setModel] = useState(() => loadModel());
  const [profile, setProfile] = useState(() => loadProfile());
  const [plan, setPlan] = useState(() => loadPlan());
  // Always-current plan for async handlers: updates compose instead of overwriting each other
  // while a slow Gemini call is in flight.
  const planRef = useRef(plan);
  const commitPlan = (updater) => {
    const next = typeof updater === 'function' ? updater(planRef.current) : updater;
    if (next === planRef.current) return;
    planRef.current = next;
    setPlan(next);
    savePlan(next);
  };
  const [feedbackHistory, setFeedbackHistory] = useState(() => loadFeedbackHistory());
  const [healthAck, setHealthAck] = useState(() => loadHealthAck());
  const [logs, setLogs] = useState(() => loadWorkoutLogs());
  const logsRef = useRef(logs);
  const [chat, setChat] = useState(() => loadCoachChat());
  const chatRef = useRef(chat);
  const [askBusy, setAskBusy] = useState(false);
  const [askError, setAskError] = useState('');
  const [askFocus, setAskFocus] = useState(null);
  const [reports, setReports] = useState(() => loadLabReports());
  const reportsRef = useRef(reports);
  const [scans, setScans] = useState(() => loadBodyScans());
  const scansRef = useRef(scans);
  const commitScans = (next) => {
    const clean = saveBodyScans(next);
    scansRef.current = clean;
    setScans(clean);
    return clean;
  };
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [busyKey, setBusyKey] = useState('');
  const [errorMsg, setErrorMsg] = useState('');

  const finishOnboarding = () => {
    saveOnboarded(true);
    setOnboarded(true);
  };

  const askQuestion = (text) => {
    setAskFocus({ exerciseId: null, draft: text, nonce: Date.now() });
    setAskError('');
    setTab('ask');
  };

  const handleExtractLabs = (file) => extractLabReport({ file, apiKey, model });
  const handleExtractScan = (file) => extractBodyScan({ file, apiKey, model });

  // Saves (or replaces) a scan. When asked, and when it's the newest scan, profile weight and body fat follow it.
  const handleSaveScan = (scan, updateWeight) => {
    const saved = commitScans([...scansRef.current.filter((s) => s.id !== scan.id), scan]);
    if (updateWeight && saved.at(-1)?.id === scan.id) {
      const next = { ...profile };
      if (scan.metrics.weightKg != null) next.weightKg = Math.min(180, Math.max(40, Number(scan.metrics.weightKg.toFixed(1))));
      if (scan.metrics.pbf != null) next.bodyFatPct = String(scan.metrics.pbf);
      handleProfileChange(next);
    }
  };
  const handleDeleteScan = (id) => commitScans(scansRef.current.filter((s) => s.id !== id));

  const handleProfileChange = (next) => {
    // A report added through the guided setup becomes part of the report history.
    if (next.labs !== profile.labs) {
      const others = reportsRef.current.filter((r) => r.id !== 'lab_profile');
      const stored = commitReports(next.labs ? [...others, { ...next.labs, id: 'lab_profile' }] : others, false);
      next = { ...next, labs: latestLabsForProfile(stored) };
    }
    setProfile(next);
    saveProfile(next);
  };

  // Saves the report list and keeps profile.labs (which drives plan safety) equal to the latest report.
  const commitReports = (list, syncProfile = true) => {
    const clean = saveLabReports(list);
    reportsRef.current = clean;
    setReports(clean);
    if (syncProfile) {
      setProfile((p) => {
        const next = { ...p, labs: latestLabsForProfile(clean) };
        saveProfile(next);
        return next;
      });
    }
    return clean;
  };
  const handleSaveReport = (report) => commitReports([...reportsRef.current.filter((r) => r.id !== report.id), report]);
  const handleDeleteReport = (id) => commitReports(reportsRef.current.filter((r) => r.id !== id));
  const handleAnalyzeReport = async (id) => {
    const analysis = await analyzeLabReport({ reports: reportsRef.current, reportId: id, profile, apiKey, model });
    commitReports(reportsRef.current.map((r) => (r.id === id ? { ...r, analysis } : r)));
  };

  const handleApplyChatPatch = (patch) => {
    if (!patch || typeof patch !== 'object') return [];
    const next = {
      ...profile,
      jointFlags: { ...profile.jointFlags },
    };
    const updated = [];

    if (Number.isFinite(patch.age) && patch.age >= 16 && patch.age <= 85) {
      next.age = Math.round(patch.age);
      updated.push(`Age (${next.age})`);
    }
    if (Number.isFinite(patch.heightCm) && patch.heightCm >= 130 && patch.heightCm <= 220) {
      next.heightCm = Math.round(patch.heightCm);
      updated.push('Height');
    }
    if (Number.isFinite(patch.weightKg) && patch.weightKg >= 40 && patch.weightKg <= 180) {
      next.weightKg = Number(patch.weightKg.toFixed(1));
      updated.push('Weight');
    }
    if (Number.isFinite(patch.restingHr) && patch.restingHr >= 40 && patch.restingHr <= 115) {
      next.restingHr = Math.round(patch.restingHr);
      updated.push(`RHR (${next.restingHr})`);
    }
    if (Number.isFinite(patch.sleepHours) && patch.sleepHours >= 3 && patch.sleepHours <= 12) {
      next.sleepHours = Number(patch.sleepHours);
      updated.push(`Sleep (${next.sleepHours}h)`);
    }
    if (VALID_LEVELS.has(patch.stressLevel)) {
      next.stressLevel = patch.stressLevel;
      updated.push(`Stress (${patch.stressLevel})`);
    }
    if (Number.isFinite(patch.weeksAway) && patch.weeksAway >= 0 && patch.weeksAway <= 104) {
      next.weeksAway = Math.round(patch.weeksAway);
      updated.push(`Weeks off (${next.weeksAway})`);
    }
    if (VALID_LEVELS.has(patch.energyLevel)) {
      next.energyLevel = patch.energyLevel;
      updated.push(`Energy (${patch.energyLevel})`);
    }
    if (VALID_EXPERIENCE.has(patch.experience)) {
      next.experience = patch.experience;
      updated.push(`Experience (${patch.experience})`);
    }
    if (VALID_GOALS.has(patch.goal)) {
      next.goal = patch.goal;
      updated.push('Goal');
    }
    if (VALID_TIERS.has(patch.equipmentTier)) {
      next.equipmentTier = patch.equipmentTier;
      updated.push('Equipment');
    }
    if (Number.isFinite(patch.daysPerWeek) && patch.daysPerWeek >= 2 && patch.daysPerWeek <= 5) {
      next.daysPerWeek = Math.round(patch.daysPerWeek);
      updated.push(`${next.daysPerWeek}d/wk`);
    }
    if (Number.isFinite(patch.sessionMinutes) && patch.sessionMinutes >= 25 && patch.sessionMinutes <= 60) {
      next.sessionMinutes = Math.round(patch.sessionMinutes / 5) * 5;
      updated.push(`${next.sessionMinutes}m`);
    }
    if (Number.isFinite(patch.programWeeks) && patch.programWeeks >= 1 && patch.programWeeks <= 4) {
      next.programWeeks = Math.round(patch.programWeeks);
      updated.push(`${next.programWeeks}-wk block`);
    }
    if (typeof patch.protectKnee === 'boolean') {
      next.jointFlags.knee = patch.protectKnee;
      if (patch.protectKnee) updated.push('Knee flag');
    }
    if (typeof patch.protectShoulder === 'boolean') {
      next.jointFlags.shoulder = patch.protectShoulder;
      if (patch.protectShoulder) updated.push('Shoulder flag');
    }
    if (typeof patch.protectLowerBack === 'boolean') {
      next.jointFlags.lower_back = patch.protectLowerBack;
      if (patch.protectLowerBack) updated.push('Lower-back flag');
    }
    if (patch.notesAppend && typeof patch.notesAppend === 'string' && patch.notesAppend.trim()) {
      const addition = patch.notesAppend.trim();
      if (!next.notes.includes(addition)) {
        next.notes = next.notes ? `${next.notes}; ${addition}` : addition;
        updated.push('Notes');
      }
    }

    if (updated.length > 0) {
      handleProfileChange(next);
    }
    return updated;
  };

  const handleSaveSettings = (nextKey, nextModel) => {
    setApiKey(nextKey);
    setModel(nextModel);
    saveApiKey(nextKey);
    saveModel(nextModel);
  };

  const handleLogExercise = (entry) => {
    const next = saveWorkoutLogs([{ ...entry, id: `log_${entry.ts}_${Math.random().toString(36).slice(2, 7)}` }, ...logsRef.current]);
    logsRef.current = next;
    setLogs(next);
  };

  const handleUndoLog = (id) => {
    const next = saveWorkoutLogs(logsRef.current.filter((l) => l.id !== id));
    logsRef.current = next;
    setLogs(next);
  };

  const commitChat = (next) => {
    chatRef.current = next;
    setChat(next);
    saveCoachChat(next);
  };

  // Returns true when the coach answered, so the chat box knows whether to keep the draft.
  const handleAsk = async (text, photos, focusExerciseId) => {
    const history = [...chatRef.current, { role: 'user', text, photos: photos.length }];
    commitChat(history);
    setAskBusy(true);
    setAskError('');
    try {
      const reply = await askCoach({
        messages: history,
        profile,
        plan: planRef.current,
        logs: logsRef.current,
        bodySummary: describeBodyCompForPrompt(scansRef.current),
        focusExerciseId,
        photos,
        apiKey,
        model,
      });
      commitChat([...chatRef.current, { role: 'coach', text: reply, photos: 0 }]);
      return true;
    } catch (err) {
      commitChat(chatRef.current.slice(0, -1)); // drop the unanswered question; the draft is restored in the box
      setAskError(err?.message || 'The coach could not answer. Check your key and connection.');
      return false;
    } finally {
      setAskBusy(false);
    }
  };

  const handleAskAbout = (exerciseId) => {
    const name = EXERCISE_MAP[exerciseId]?.name || 'this exercise';
    setAskFocus({
      exerciseId,
      draft: `How do I do the ${name} with good form, and what mistakes should I watch for?`,
      nonce: Date.now(),
    });
    setAskError('');
    setTab('ask');
  };

  const handleGenerate = async () => {
    finishOnboarding();
    setLoading(true);
    setErrorMsg('');
    try {
      const safeExercises = filterSafeExercises(profile);
      const nextPlan = await generateAdaptivePlan(
        profile,
        safeExercises,
        apiKey,
        model,
        feedbackHistory,
        summarizeLogsForPrompt(logsRef.current, profile.unitSystem),
        describeBodyCompForPrompt(scansRef.current)
      );
      commitPlan(nextPlan);
      setTab('routine');
    } catch (err) {
      setErrorMsg(
        err?.message ||
          'Could not generate plan. Check your Gemini API key or model in Settings.'
      );
    } finally {
      setLoading(false);
    }
  };

  const handleSwapExercise = async (weekIdx, dayIdx, exIdx, reason, applyAllWeeks = false) => {
    const plan = planRef.current;
    if (!plan?.weeks?.[weekIdx]?.days?.[dayIdx]) return;
    const key = `swap-${weekIdx}-${dayIdx}-${exIdx}`;
    setBusyKey(key);
    setErrorMsg('');
    try {
      const safeExercises = filterSafeExercises(profile);
      const currentDay = plan.weeks[weekIdx].days[dayIdx];
      const currentItem = currentDay.exercises[exIdx];
      const dayExerciseIds = currentDay.exercises.map((e) => e.exercise_id);
      const weekExerciseIds = plan.weeks[weekIdx].days.flatMap((d) =>
        d.exercises.map((e) => e.exercise_id)
      );
      const replacement = await swapExercise(
        currentItem,
        reason,
        profile,
        safeExercises,
        apiKey,
        model,
        dayExerciseIds,
        weekExerciseIds
      );
      commitPlan((latest) => {
        // Prescription of the swapped slot in the week the swap was made in; other weeks follow its progression.
        const baseItem = latest.weeks[weekIdx]?.days?.[dayIdx]?.exercises?.[exIdx] || currentItem;
        const withNote = (r) => ({
          ...r,
          coach_note: r.swap_rationale ? `${r.swap_rationale} ${r.coach_note || ''}`.trim() : r.coach_note,
        });
        return {
          ...latest,
          weeks: latest.weeks.map((wk, wIdx) => {
            const isOrigin = wIdx === weekIdx;
            if (!isOrigin && !applyAllWeeks) return wk;
            return {
              ...wk,
              days: wk.days.map((d, dIdx) => {
                if (dIdx !== dayIdx) return d;
                const slot = d.exercises[exIdx];
                // Other weeks only change if they still hold the exercise that was swapped out.
                if (!slot || (!isOrigin && slot.exercise_id !== currentItem.exercise_id)) return d;
                const others = d.exercises.filter((_, i) => i !== exIdx).map((e) => e.exercise_id);
                const candidate = isOrigin ? replacement : carryProgression(replacement, baseItem, slot);
                const resolved = resolveSwapConflict(candidate, others, safeExercises);
                if (!resolved) return d;
                const nextEx = [...d.exercises];
                nextEx[exIdx] = withNote(resolved);
                return { ...d, exercises: nextEx };
              }),
            };
          }),
        };
      });
    } catch (err) {
      setErrorMsg(err?.message || 'Swap failed. Try again or check Settings.');
    } finally {
      setBusyKey('');
    }
  };

  const handleAdaptDay = async (weekIdx, dayIdx, constraint) => {
    const plan = planRef.current;
    if (!plan?.weeks?.[weekIdx]?.days?.[dayIdx]) return;
    setBusyKey(`adapt-${weekIdx}-${dayIdx}`);
    setErrorMsg('');
    try {
      const safeExercises = filterSafeExercises(profile);
      const adapted = await adaptSingleDay(
        plan.weeks[weekIdx].days[dayIdx],
        constraint,
        profile,
        safeExercises,
        apiKey,
        model
      );
      commitPlan((latest) => ({
        ...latest,
        weeks: latest.weeks.map((wk, wIdx) =>
          wIdx !== weekIdx
            ? wk
            : { ...wk, days: wk.days.map((d, dIdx) => (dIdx === dayIdx ? adapted : d)) }
        ),
      }));
    } catch (err) {
      setErrorMsg(err?.message || 'Day adaptation failed.');
    } finally {
      setBusyKey('');
    }
  };

  const handleFeedback = (rating) => {
    const next = appendFeedback({ rating, planTitle: plan?.program_title });
    setFeedbackHistory(next);
  };

  const handleDataImported = (restored) => {
    setProfile(restored.profile);
    planRef.current = restored.activePlan;
    setPlan(restored.activePlan);
    setFeedbackHistory(restored.feedbackHistory);
    reportsRef.current = restored.labReports || [];
    setReports(reportsRef.current);
    scansRef.current = restored.bodyScans || [];
    setScans(scansRef.current);
    logsRef.current = restored.workoutLogs || [];
    setLogs(logsRef.current);
  };

  return (
    <>
    <Watermark tab={tab} />
    <div className={`app-shell tab-${tab}`}>
      <header className="top-bar">
        <div className="brand">
          <h1 className="brand-h1" aria-label="Repwise">
            <Wordmark />
          </h1>
        </div>

        <select
          className="person-select"
          aria-label="Switch person"
          value={profileId}
          onChange={(e) => (e.target.value === '__add' ? onAddPerson() : onSwitch(e.target.value))}
        >
          {people.map((p) => (
            <option key={p.id} value={p.id}>
              {p.id === profileId && profile.name ? profile.name : p.name}
            </option>
          ))}
          {people.length < 6 && <option value="__add">+ Add a person</option>}
        </select>

        <button
          type="button"
          className={`key-pill ${apiKey ? 'key-pill-on' : ''}`}
          onClick={() => setSettingsOpen(true)}
        >
          <KeyIcon size={15} />
          <span>{apiKey ? 'Gemini Connected' : 'API Key'}</span>
        </button>
      </header>

      {errorMsg && (
        <div className="status-banner status-error" style={{ marginBottom: '12px' }}>
          <span>{errorMsg}</span>
          <button type="button" className="icon-btn" onClick={() => setErrorMsg('')}>
            ✕
          </button>
        </div>
      )}

      <main className="main-content">
        {tab === 'assess' && (
          <HealthNotice
            acknowledged={healthAck}
            onAcknowledge={() => {
              saveHealthAck();
              setHealthAck(true);
            }}
          />
        )}

        {tab === 'assess' && !onboarded && (
          <Onboarding
            profile={profile}
            onChange={handleProfileChange}
            apiKey={apiKey}
            onExtract={handleExtractLabs}
            onFinish={handleGenerate}
            onSkip={finishOnboarding}
            loading={loading}
          />
        )}

        {tab === 'assess' && onboarded && (
          <AssessmentForm
            profile={profile}
            onChange={handleProfileChange}
            onApplyChatPatch={handleApplyChatPatch}
            onGenerate={handleGenerate}
            loading={loading}
            apiKey={apiKey}
            model={model}
            extraSections={
              <ProfileExtras
                profile={profile}
                onChange={handleProfileChange}
                apiKey={apiKey}
                onExtract={handleExtractLabs}
                canRemove={profileId !== 'default'}
                onOpenHealth={() => setTab('health')}
                onRemove={() => onRemovePerson(profileId)}
              />
            }
          />
        )}

        {tab === 'routine' && plan && retestDue(profile) && (
          <div className="status-banner status-warning" style={{ marginBottom: '12px' }}>
            <span>⏱️ Block done? Retest your fitness to see how far you've come.</span>
            <button type="button" className="link-btn" onClick={() => setTab('assess')}>
              Retest
            </button>
          </div>
        )}

        {tab === 'routine' && plan && <PlanWhy plan={plan} profile={profile} onAsk={askQuestion} />}

        {tab === 'routine' && (
          <RoutineView
            plan={plan}
            onSwapExercise={handleSwapExercise}
            onAdaptDay={handleAdaptDay}
            onSubmitFeedback={handleFeedback}
            logs={logs}
            unitSystem={profile.unitSystem}
            onLogExercise={handleLogExercise}
            onUndoLog={handleUndoLog}
            onAskAbout={handleAskAbout}
            busyKey={busyKey}
            onGoToAssessment={() => setTab('assess')}
          />
        )}

        {tab === 'ask' && (
          <AskCoach
            apiKey={apiKey}
            chat={chat}
            busy={askBusy}
            error={askError}
            focus={askFocus}
            onClearFocus={() => setAskFocus(null)}
            onAsk={handleAsk}
            onClearChat={() => {
              commitChat([]);
              setAskError('');
            }}
            onOpenSettings={() => setSettingsOpen(true)}
          />
        )}

        {tab === 'health' && (
          <HealthView
            reports={reports}
            profile={profile}
            apiKey={apiKey}
            onSave={handleSaveReport}
            onDelete={handleDeleteReport}
            onExtract={handleExtractLabs}
            onAnalyze={handleAnalyzeReport}
            onAsk={apiKey ? askQuestion : null}
          />
        )}

        {tab === 'progress' && (
          <ProgressView
            scans={scans}
            onSaveScan={handleSaveScan}
            onDeleteScan={handleDeleteScan}
            onExtract={handleExtractScan}
            apiKey={apiKey}
            profile={profile}
            logs={logs}
            onAsk={apiKey ? askQuestion : null}
            onRetest={() => setTab('assess')}
          />
        )}

        {tab === 'library' && <CatalogBrowser defaultTier={profile.equipmentTier} />}
      </main>

      <nav className="bottom-nav" aria-label="Primary navigation">
        <button
          type="button"
          className={`nav-item ${tab === 'assess' ? 'nav-active' : ''}`}
          aria-current={tab === 'assess' ? 'page' : undefined}
          onClick={() => setTab('assess')}
        >
          <span className="nav-icon-wrap">
            <CoachIcon size={21} />
          </span>
          <span className="nav-label">Coach</span>
        </button>
        <button
          type="button"
          className={`nav-item ${tab === 'routine' ? 'nav-active' : ''}`}
          aria-current={tab === 'routine' ? 'page' : undefined}
          onClick={() => setTab('routine')}
        >
          <span className="nav-icon-wrap">
            <WorkoutIcon size={21} />
          </span>
          <span className="nav-label">Workout</span>
        </button>
        <button
          type="button"
          className={`nav-item ${tab === 'ask' ? 'nav-active' : ''}`}
          aria-current={tab === 'ask' ? 'page' : undefined}
          onClick={() => setTab('ask')}
        >
          <span className="nav-icon-wrap">
            <ChatIcon size={21} />
          </span>
          <span className="nav-label">Ask</span>
        </button>
        <button
          type="button"
          className={`nav-item ${tab === 'health' ? 'nav-active' : ''}`}
          aria-current={tab === 'health' ? 'page' : undefined}
          onClick={() => setTab('health')}
        >
          <span className="nav-icon-wrap">
            <HealthIcon size={21} />
          </span>
          <span className="nav-label">Health</span>
        </button>
        <button
          type="button"
          className={`nav-item ${tab === 'progress' ? 'nav-active' : ''}`}
          aria-current={tab === 'progress' ? 'page' : undefined}
          onClick={() => setTab('progress')}
        >
          <span className="nav-icon-wrap">
            <ProgressIcon size={21} />
          </span>
          <span className="nav-label">Progress</span>
        </button>
        <button
          type="button"
          className={`nav-item ${tab === 'library' ? 'nav-active' : ''}`}
          aria-current={tab === 'library' ? 'page' : undefined}
          onClick={() => setTab('library')}
        >
          <span className="nav-icon-wrap">
            <ExercisesIcon size={21} />
          </span>
          <span className="nav-label">Exercises</span>
        </button>
      </nav>

      <SettingsModal
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        apiKey={apiKey}
        model={model}
        onSaveSettings={handleSaveSettings}
        onDataImported={handleDataImported}
      />
    </div>
    </>
  );
}

const EXTRA_SECTIONS = [
  ['health', 'Health check', '❤️'],
  ['injuries', 'Injuries & sore spots', '🩹'],
  ['test', 'Fitness test', '🧪'],
  ['labs', 'Blood report', '🩸'],
  ['about', 'About you', '🙋'],
];

/** The setup questions, editable any time from the Coach tab. */
function ProfileExtras({ profile, onChange, apiKey, onExtract, canRemove, onRemove, onOpenHealth }) {
  const [open, setOpen] = useState(null);
  const { checks, pct } = profileCompleteness(profile);
  const done = Object.fromEntries(checks.map(([k, v]) => [k, v]));
  const doneFor = { health: done['Health check'], injuries: done.Injuries, test: done['Fitness test'], labs: done['Blood report'], about: done['About you'] };
  return (
    <section className="card">
      <div className="card-head">
        <h2>Health & background</h2>
        <span className="muted">{pct}% complete</span>
      </div>
      <div className="completeness" aria-label={`Profile ${pct}% complete`}>
        <i style={{ width: `${pct}%` }} />
      </div>
      {EXTRA_SECTIONS.map(([id, title, icon]) => (
        <div key={id} className="extra-section">
          <button type="button" className="plan-why-toggle" aria-expanded={open === id} onClick={() => setOpen(open === id ? null : id)}>
            <span>
              {icon} <strong>{title}</strong> {doneFor[id] ? <span className="muted">✓</span> : <span className="muted">· to do</span>}
            </span>
            <span aria-hidden="true">{open === id ? '▴' : '▾'}</span>
          </button>
          {open === id && (
            <div style={{ padding: '6px 0 12px' }}>
              {id === 'health' && <HealthCheck profile={profile} onChange={onChange} />}
              {id === 'injuries' && <InjuryGrid profile={profile} onChange={onChange} />}
              {id === 'test' && <FitnessTest profile={profile} onChange={onChange} />}
              {id === 'labs' && (
                <div>
                  <p className="muted">Blood reports now have their own tab, with history, AI analysis and tips.</p>
                  <button type="button" className="secondary-btn" onClick={onOpenHealth} style={{ marginTop: '8px' }}>
                    Open Health tab
                  </button>
                </div>
              )}
              {id === 'about' && <AboutYou profile={profile} onChange={onChange} />}
            </div>
          )}
        </div>
      ))}
      <p className="muted" style={{ fontSize: '0.8rem' }}>Changes apply the next time you generate a plan.</p>
      {canRemove && (
        <button
          type="button"
          className="secondary-btn"
          onClick={() => {
            if (typeof window === 'undefined' || !window.confirm || window.confirm(`Remove ${profile.name || 'this person'} and all their data from this device?`)) onRemove();
          }}
        >
          Remove this person from the device
        </button>
      )}
    </section>
  );
}
