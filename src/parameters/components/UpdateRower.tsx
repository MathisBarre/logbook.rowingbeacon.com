import { useTranslation } from "react-i18next";
import { Label } from "../../_common/components/Label";
import Button from "../../_common/components/Button";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { useClubOverviewStore } from "../../_common/store/clubOverview.store";
import { useModule } from "../../_common/store/modules.store";
import { ModuleSuggestion } from "../../_common/components/ModuleSuggestion";
import { toast } from "sonner";
import {
  SERIOUSNESS_CATEGORIES,
  SeriousnessCategoryEnum,
} from "../../_common/business/seriousness.rules";
import { AGE_CATEGORIES } from "../../_common/business/ageCategory.rules";
import { AgeCategoryEnum } from "../../_common/business/ageCategory.rules";
import { getRowerFullName } from "../../_common/business/rower.rules";
import { ClubRower } from "../../_common/database/repositories/club.types";

const UpdateRowerFormSchema = z.object({
  firstName: z.string().trim().min(1),
  lastName: z.string().trim(),
  category: z.enum([
    "null",
    AgeCategoryEnum.J10,
    AgeCategoryEnum.J12,
    AgeCategoryEnum.J14,
    AgeCategoryEnum.J16,
    AgeCategoryEnum.J18,
    AgeCategoryEnum.SENIOR,
  ]),
  type: z.enum([
    "null",
    SeriousnessCategoryEnum.RECREATIONAL,
    SeriousnessCategoryEnum.COMPETITOR,
  ]),
  status: z.enum(["member", "guest", "other"]),
  gender: z.enum(["", "female", "male", "other"]),
  birthDate: z.string(),
  licenseNumber: z.string(),
  email: z.string(),
  phone: z.string(),
  address: z.string(),
  note: z.string(),
});

type UpdateRowerFormValues = z.infer<typeof UpdateRowerFormSchema>;

const emptyToNull = (value: string) => value.trim() || null;

export const UpdateRower = ({
  rower,
  close,
}: {
  rower: ClubRower;
  close: () => void;
}) => {
  const { t } = useTranslation();
  const { updateRower } = useClubOverviewStore();
  const hasMemberProfile = useModule("memberProfile");
  // Without the Guests module a guest would vanish from the lists.
  const canBeGuest = useModule("guests") || rower.status === "guest";
  // A guest can always be turned into a member, even without the profile.
  const showStatus = hasMemberProfile || rower.status === "guest";

  const form = useForm<UpdateRowerFormValues>({
    resolver: zodResolver(UpdateRowerFormSchema),
    defaultValues: {
      firstName: rower.firstName,
      lastName: rower.lastName,
      category: rower.category || "null",
      type: rower.type || "null",
      status: rower.status,
      gender: rower.gender ?? "",
      birthDate: rower.birthDate ?? "",
      licenseNumber: rower.licenseNumber ?? "",
      email: rower.email ?? "",
      phone: rower.phone ?? "",
      address: rower.address ?? "",
      note: rower.note ?? "",
    },
  });

  const nameError = form.formState.errors.firstName && (
    <p className="form-error">{t("parameters.nameRequired")}</p>
  );

  const onSubmit = (values: UpdateRowerFormValues) => {
    updateRower(rower.id, {
      firstName: values.firstName,
      lastName: values.lastName,
      category: values.category === "null" ? undefined : values.category,
      type: values.type === "null" ? undefined : values.type,
      // Fields hidden by a disabled module keep their stored value.
      ...(showStatus ? { status: values.status } : {}),
      ...(hasMemberProfile
        ? {
            gender: values.gender === "" ? null : values.gender,
            birthDate: emptyToNull(values.birthDate),
            licenseNumber: emptyToNull(values.licenseNumber),
            email: emptyToNull(values.email),
            phone: emptyToNull(values.phone),
            address: emptyToNull(values.address),
            note: emptyToNull(values.note),
          }
        : {}),
    });

    toast.success(t("parameters.rowerUpdated"));
    close();
  };

  return (
    <form
      onSubmit={(e) => {
        void form.handleSubmit(onSubmit)(e);
      }}
    >
      <div className="flex flex-col gap-4">
        {hasMemberProfile ? (
          <div className="grid grid-cols-2 gap-4">
            <Label className="flex flex-col gap-1">
              {t("rower.firstName")}
              <input className="input" {...form.register("firstName")} />
              {nameError}
            </Label>
            <Label className="flex flex-col gap-1">
              {t("rower.lastName")}
              <input className="input" {...form.register("lastName")} />
            </Label>
          </div>
        ) : (
          <Label className="flex flex-col gap-1">
            {t("rower.name")}
            <input
              className="input"
              type="text"
              defaultValue={getRowerFullName(rower)}
              onChange={(e) => {
                const [firstName, ...rest] = e.target.value.trim().split(/\s+/);
                form.setValue("firstName", firstName ?? "", {
                  shouldDirty: true,
                });
                form.setValue("lastName", rest.join(" "), {
                  shouldDirty: true,
                });
              }}
            />
            {nameError}
          </Label>
        )}

        <div className="grid grid-cols-2 gap-4">
          <Label className="flex flex-col gap-1">
            {t("rower.category")}
            <select className="input" {...form.register("category")}>
              {AGE_CATEGORIES.map((category) => (
                <option
                  key={category.category}
                  value={category.category || "null"}
                >
                  {category.category || t("parameters.noCategory")}
                </option>
              ))}
            </select>
          </Label>

          <Label className="flex flex-col gap-1">
            {t("parameters.type")}
            <select className="input" {...form.register("type")}>
              {SERIOUSNESS_CATEGORIES.map((type) => (
                <option key={type.type} value={type.type || "null"}>
                  {type.translationKey
                    ? t(type.translationKey)
                    : t("parameters.noType")}
                </option>
              ))}
            </select>
          </Label>
        </div>

        {showStatus && (
          <Label className="flex flex-col gap-1">
            {t("rower.status")}
            <select className="input" {...form.register("status")}>
              <option value="member">{t("rower.statusMember")}</option>
              {canBeGuest && (
                <option value="guest">{t("rower.statusGuest")}</option>
              )}
              <option value="other">{t("rower.statusOther")}</option>
            </select>
          </Label>
        )}

        {hasMemberProfile && (
          <>
            <div className="grid grid-cols-2 gap-4">
              <Label className="flex flex-col gap-1">
                {t("rower.gender")}
                <select className="input" {...form.register("gender")}>
                  <option value="">{t("rower.genderUnknown")}</option>
                  <option value="female">{t("rower.genderFemale")}</option>
                  <option value="male">{t("rower.genderMale")}</option>
                  <option value="other">{t("rower.genderOther")}</option>
                </select>
              </Label>
              <Label className="flex flex-col gap-1">
                {t("rower.birthDate")}
                <input
                  className="input"
                  type="date"
                  {...form.register("birthDate")}
                />
              </Label>
            </div>
            <div className="grid grid-cols-3 gap-4">
              <Label className="flex flex-col gap-1">
                {t("rower.licenseNumber")}
                <input className="input" {...form.register("licenseNumber")} />
              </Label>
              <Label className="flex flex-col gap-1">
                {t("rower.email")}
                <input
                  className="input"
                  type="email"
                  {...form.register("email")}
                />
              </Label>
              <Label className="flex flex-col gap-1">
                {t("rower.phone")}
                <input
                  className="input"
                  type="tel"
                  {...form.register("phone")}
                />
              </Label>
            </div>
            <Label className="flex flex-col gap-1">
              {t("rower.address")}
              <textarea
                rows={2}
                className="input resize-y"
                {...form.register("address")}
              />
            </Label>
            <Label className="flex flex-col gap-1">
              {t("rower.note")}
              <textarea
                rows={2}
                className="input resize-y"
                {...form.register("note")}
              />
            </Label>
          </>
        )}

        <ModuleSuggestion id="memberProfile" />
      </div>

      <div className="h-4" />

      <div className="flex justify-end gap-2">
        <Button
          type="submit"
          className="flex-1"
          disabled={!form.formState.isDirty}
        >
          {t("parameters.updateConfiguration")}
        </Button>
      </div>
    </form>
  );
};
