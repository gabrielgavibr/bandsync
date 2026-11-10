import { useEffect, useState } from "react";

/** Narrow screens, and phones held sideways (little height): where vertical space is scarce. */
const QUERY = "(max-width: 639px), (max-height: 520px)";

export function useIsPhone(): boolean {
  const [phone, setPhone] = useState(
    () => typeof matchMedia !== "undefined" && matchMedia(QUERY).matches,
  );
  useEffect(() => {
    if (typeof matchMedia === "undefined") return;
    const mq = matchMedia(QUERY);
    const on = () => setPhone(mq.matches);
    on();
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  return phone;
}
