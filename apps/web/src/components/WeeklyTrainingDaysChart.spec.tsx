import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { WeeklyTrainingDaysChart } from "./WeeklyTrainingDaysChart";

describe("WeeklyTrainingDaysChart", () => {
  // The suite runs west of UTC (DN-127), where a week start read as local
  // time is the Sunday evening before it. Month-day order follows the
  // machine's locale, which the component leaves to the browser.
  it("labels a week by the Monday it starts on", () => {
    render(<WeeklyTrainingDaysChart weeks={[{ weekStart: "2026-10-05", days: 3 }]} cap={5} />);

    expect(screen.getByText(/^(Oct 5|5 Oct)$/)).toBeInTheDocument();
  });
});
