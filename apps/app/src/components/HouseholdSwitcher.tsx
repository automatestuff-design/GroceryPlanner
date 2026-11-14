import type { HouseholdMode } from "@mealplan/core";
import { Segmented } from "./ui";

/** The personal/family switch, always one tap away at the top of chat and plan. */
export function HouseholdSwitcher({ mode, onChange }: { mode: HouseholdMode; onChange: (m: HouseholdMode) => void }) {
  return (
    <Segmented<HouseholdMode>
      value={mode}
      onChange={onChange}
      options={[{ value: "personal", label: "Just me" }, { value: "family", label: "Family" }]}
    />
  );
}
