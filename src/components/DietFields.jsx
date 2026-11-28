import React from 'react';
import { ALLERGENS, DIET_TYPES, sanitizeDiet } from '../services/nutrition';

/** How someone eats: diet type, allergies, meals a day, foods to skip, cuisines. Used in setup, the Coach form and Nutrition. */
export default function DietFields({ profile, onChange, idPrefix = 'diet' }) {
  const diet = sanitizeDiet(profile.diet);
  const set = (patch) => onChange({ ...profile, diet: { ...diet, ...patch } });
  const toggleAllergy = (id) => set({ allergies: diet.allergies.includes(id) ? diet.allergies.filter((a) => a !== id) : [...diet.allergies, id] });
  return (
    <div className="diet-fields">
      <div className="form-group">
        <label htmlFor={`${idPrefix}-type`}>What do you eat?</label>
        <select id={`${idPrefix}-type`} value={diet.dietType} onChange={(e) => set({ dietType: e.target.value })}>
          {DIET_TYPES.map((d) => (
            <option key={d.id} value={d.id}>{d.label}</option>
          ))}
        </select>
      </div>
      <div className="form-group">
        <span className="field-label" id={`${idPrefix}-allergy-label`}>Allergies</span>
        <div className="chip-row" role="group" aria-labelledby={`${idPrefix}-allergy-label`}>
          {ALLERGENS.map((a) => (
            <button key={a.id} type="button" className={`chip ${diet.allergies.includes(a.id) ? 'chip-active' : ''}`} aria-pressed={diet.allergies.includes(a.id)} onClick={() => toggleAllergy(a.id)}>
              {a.label}
            </button>
          ))}
        </div>
      </div>
      <div className="form-group">
        <label htmlFor={`${idPrefix}-meals`}>Meals a day</label>
        <select id={`${idPrefix}-meals`} value={diet.mealsPerDay} onChange={(e) => set({ mealsPerDay: Number(e.target.value) })}>
          <option value={3}>3 meals</option>
          <option value={4}>3 meals + a snack</option>
          <option value={5}>3 meals + 2 snacks</option>
        </select>
      </div>
      <div className="form-group">
        <label htmlFor={`${idPrefix}-avoid`}>Foods you don't eat (optional)</label>
        <input id={`${idPrefix}-avoid`} type="text" maxLength={120} placeholder="e.g. mushrooms, beetroot" value={diet.avoid} onChange={(e) => set({ avoid: e.target.value })} />
      </div>
      <div className="form-group">
        <label htmlFor={`${idPrefix}-cuisine`}>Favourite cuisines (optional)</label>
        <input id={`${idPrefix}-cuisine`} type="text" maxLength={80} placeholder="Any, or e.g. South Indian, Mediterranean" value={diet.cuisines} onChange={(e) => set({ cuisines: e.target.value })} />
      </div>
    </div>
  );
}
