import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { FIELD, type SettingsFormState } from "@/lib/notifications/form";
import {
  DEFAULT_PREFS,
  type NotificationPrefs,
} from "@/lib/notifications/prefs";
import { NotificationSettingsForm } from "./notification-settings-form";

const ZONES = ["America/Chicago", "Europe/Paris", "UTC"];

const renderForm = (
  options: {
    prefs?: NotificationPrefs;
    suggestBrowserZone?: boolean;
    result?: SettingsFormState;
  } = {},
) => {
  const action = vi.fn(
    async (_state: SettingsFormState, _formData: FormData) =>
      options.result ?? ({ status: "saved" } as SettingsFormState),
  );
  render(
    <NotificationSettingsForm
      prefs={options.prefs ?? structuredClone(DEFAULT_PREFS)}
      suggestBrowserZone={options.suggestBrowserZone ?? false}
      timeZones={ZONES}
      action={action}
    />,
  );
  return action;
};

const submitted = (action: ReturnType<typeof renderForm>) =>
  action.mock.calls[0]![1];

describe("NotificationSettingsForm", () => {
  it("has a push and an email box for each of the four alerts, set from the preferences", () => {
    renderForm();
    const expected: [string, boolean, boolean][] = [
      ["Out for delivery", true, false],
      ["Delivered or ready for pickup", true, true],
      ["Problems", true, true],
      ["Delays", true, false],
    ];
    for (const [name, push, email] of expected) {
      expect(screen.getByLabelText(`${name} by push`)).toHaveProperty(
        "checked",
        push,
      );
      expect(screen.getByLabelText(`${name} by email`)).toHaveProperty(
        "checked",
        email,
      );
    }
  });

  it("shows the stored quiet hours", () => {
    const prefs = structuredClone(DEFAULT_PREFS);
    prefs.quiet = {
      enabled: true,
      start: 23 * 60 + 30,
      end: 6 * 60,
      timeZone: "Europe/Paris",
    };
    renderForm({ prefs });

    expect(
      screen.getByLabelText(/Hold alerts during quiet hours/),
    ).toBeChecked();
    expect(screen.getByLabelText("From")).toHaveValue("23:30");
    expect(screen.getByLabelText("Until")).toHaveValue("06:00");
    expect(screen.getByLabelText("Time zone")).toHaveValue("Europe/Paris");
  });

  it("offers the time zones in a list", () => {
    renderForm();
    const list = document.getElementById("time-zones")!;
    expect([...list.querySelectorAll("option")].map((o) => o.value)).toEqual(
      ZONES,
    );
    expect(screen.getByLabelText("Time zone")).toHaveAttribute(
      "list",
      "time-zones",
    );
  });

  it("submits exactly the checked boxes, the times and the zone, and nothing else", async () => {
    const action = renderForm();

    await userEvent.click(screen.getByLabelText("Delays by push")); // off
    await userEvent.click(screen.getByLabelText("Delays by email")); // on
    await userEvent.click(
      screen.getByRole("button", { name: "Save settings" }),
    );

    const data = submitted(action);
    expect(data.get(FIELD.push("delay"))).toBeNull();
    expect(data.get(FIELD.email("delay"))).toBe("on");
    expect(data.get(FIELD.push("delivered"))).toBe("on");
    expect(data.get(FIELD.quietStart)).toBe("22:00");
    expect(data.get(FIELD.quietEnd)).toBe("07:00");
    expect(data.get(FIELD.timeZone)).toBe("UTC");
    const names = [...data.keys()];
    expect(names.every((n) => /^(push_|email_|quiet_|time_zone)/.test(n))).toBe(
      true,
    );
  });

  it("shows that it saved", async () => {
    renderForm({ result: { status: "saved" } });
    await userEvent.click(
      screen.getByRole("button", { name: "Save settings" }),
    );
    expect(await screen.findByRole("status")).toHaveTextContent("Saved.");
  });

  it("shows the server's message when it could not save", async () => {
    renderForm({
      result: {
        status: "error",
        message: "Enter quiet hours as times, like 22:00.",
      },
    });
    await userEvent.click(
      screen.getByRole("button", { name: "Save settings" }),
    );
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Enter quiet hours as times, like 22:00.",
    );
  });

  it("fills in the browser's own time zone for someone who has never saved", () => {
    const spy = vi
      .spyOn(Intl, "DateTimeFormat")
      .mockImplementation(
        () =>
          ({ resolvedOptions: () => ({ timeZone: "Europe/Paris" }) }) as never,
      );
    renderForm({ suggestBrowserZone: true });
    expect(screen.getByLabelText("Time zone")).toHaveValue("Europe/Paris");
    spy.mockRestore();
  });

  it("leaves a saved time zone alone", () => {
    const prefs = structuredClone(DEFAULT_PREFS);
    prefs.quiet.timeZone = "America/Chicago";
    renderForm({ prefs, suggestBrowserZone: false });
    expect(screen.getByLabelText("Time zone")).toHaveValue("America/Chicago");
  });

  it("keeps the default zone if the browser will not say", () => {
    const spy = vi.spyOn(Intl, "DateTimeFormat").mockImplementation(() => {
      throw new Error("no Intl");
    });
    renderForm({ suggestBrowserZone: true });
    expect(screen.getByLabelText("Time zone")).toHaveValue("UTC");
    spy.mockRestore();
  });
});
