import { createContext, ReactNode, useContext } from "react";
import { createPortal } from "react-dom";

/**
 * The hub's header has a slot, just before the season, where the open tab
 * puts its own buttons ("Modifier" on the dashboard, review 2): one header
 * row instead of a toolbar row under the tabs. The hub provides the slot's
 * element (null until it is mounted, and on the server).
 */
export const HubHeaderSlotContext = createContext<HTMLElement | null>(null);

/** Renders its children in the hub header; nothing outside the hub. */
export const HubHeaderActions = ({ children }: { children: ReactNode }) => {
  const slot = useContext(HubHeaderSlotContext);
  return slot ? createPortal(children, slot) : null;
};
