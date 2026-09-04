/**
 * The words that send a call to a person, whatever the model decides.
 *
 * This lived inside the test line's loop, and the test line is not the phone.
 * On a real call Vapi drives the model and only calls our webhook for tools, so
 * `src/agent/loop.ts` never runs — and the backstop with it. A caller rang the
 * live number and said a unit "just caught on fire yesterday". The agent
 * promised a callback, called no tool, and nothing reached the dispatcher's
 * screen. The scripted scene proving a gas leak escalates had been passing the
 * whole time, on the one path where it was already true.
 *
 * It now lives here because both paths import it.
 */
export const EMERGENCY =
  /\b(gas|smoke|fire|burning|sparking|flood(?:ing)?|carbon monoxide|electrical shock|shock(?:ed|ing)?)\b/i;
