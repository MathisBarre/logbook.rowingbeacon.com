import { useTranslation } from "react-i18next";
import { Rower } from "../../../_common/business/rower.rules";
import { getSeatFill, SeatMember, toSeatMember } from "./seatFill";

const SLOT =
  "h-7 min-w-7 px-1 rounded-full text-xs font-medium flex items-center justify-center border";

const MEMBER_COLOR = "bg-steel-blue-800 text-white border-steel-blue-800";
const GUEST_COLOR = "bg-yellow-100 text-yellow-900 border-yellow-500";
const OVERFLOW_COLOR = "bg-error-100 text-error-800 border-error-500";
const FREE_COLOR = "border-dashed border-gray-400 text-gray-500";

/**
 * Seats of the boat at a glance: one slot per rower picked, dashed slots for
 * the seats left, the cox apart, and a line saying what remains.
 */
export const SeatSlots = ({
  seats,
  rowers,
  values,
  coxed,
  cox,
}: {
  seats: number;
  rowers: Rower[];
  values: { id: string; name: string }[];
  coxed: boolean;
  cox: { id: string; name: string } | null;
}) => {
  const { t } = useTranslation();
  const fill = getSeatFill({
    seats,
    rowersCount: values.length,
    coxed,
    hasCox: cox !== null,
  });
  const coxMember = coxed && cox ? toSeatMember(cox, rowers) : null;

  const statuses = [
    fill.overflow > 0
      ? t("session.rowersOverflow", { count: fill.overflow })
      : fill.remaining > 0
        ? t("session.seatsRemaining", { count: fill.remaining })
        : null,
    fill.coxMissing ? t("session.coxMissing") : null,
  ].filter((status) => status !== null);
  const status =
    statuses.length > 0 ? statuses.join(" · ") : t("session.crewComplete");

  const describe = (member: SeatMember) =>
    member.isGuest ? `${member.name} (${t("session.guest")})` : member.name;

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
      <div className="flex flex-wrap items-center gap-1" aria-hidden="true">
        {values.map((value, index) => {
          const member = toSeatMember(value, rowers);
          const color =
            index >= seats
              ? OVERFLOW_COLOR
              : member.isGuest
                ? GUEST_COLOR
                : MEMBER_COLOR;
          return (
            <span
              key={value.id}
              title={describe(member)}
              className={`${SLOT} ${color}`}
            >
              {member.initials}
            </span>
          );
        })}
        {Array.from({ length: fill.remaining }, (_, index) => (
          <span key={`free-${index}`} className={`${SLOT} ${FREE_COLOR}`}>
            {values.length + index + 1}
          </span>
        ))}
        {coxed &&
          (coxMember ? (
            <span
              title={`${describe(coxMember)} (${t("session.cox")})`}
              className={`${SLOT} ml-1 ${coxMember.isGuest ? GUEST_COLOR : MEMBER_COLOR}`}
            >
              {coxMember.initials}
            </span>
          ) : (
            <span className={`${SLOT} ${FREE_COLOR} ml-1`}>
              {t("session.cox")}
            </span>
          ))}
      </div>
      <span
        role="status"
        className={
          "text-xs " +
          (fill.overflow > 0
            ? "text-error-700 font-medium"
            : fill.complete && !fill.coxMissing
              ? "text-green-700"
              : "text-gray-500")
        }
      >
        {status}
      </span>
    </div>
  );
};
