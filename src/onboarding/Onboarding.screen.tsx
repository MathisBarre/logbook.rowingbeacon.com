/* eslint-disable @typescript-eslint/no-misused-promises */
import Button from "../_common/components/Button";
import { Input } from "../_common/components/Input";
import { Label } from "../_common/components/Label";
import { Check } from "lucide-react";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { FormField } from "../_common/components/Form";
import { useClubOverviewStore } from "../_common/store/clubOverview.store";
import { generateBoatId } from "../_common/business/boat.rules";
import { generateRowerId } from "../_common/business/rower.rules";
import { generateRoutesId } from "../_common/business/route.rules";
import { windowAlert } from "../_common/utils/window.utils";
import { BoatTypeEnum } from "../_common/business/boat.rules";
import { hashPassword } from "../_common/utils/password";
import { TryDemoCard } from "../demo/TryDemoCard";
import { useRef, useState } from "react";
import { AdminPage } from "../_common/store/navigation.store";
import { useTranslation } from "react-i18next";
import {
  getModulesForProfile,
  OnboardingProfile,
} from "../_common/business/modules.rules";
import { useModulesStore } from "../_common/store/modules.store";
import { Efa2Project } from "../_common/efa2/efa2Project";
import {
  efa2ReadErrorMessage,
  pickEfa2Project,
} from "../_common/efa2/efa2.tauri";
import { Efa2ImportDialog } from "../parameters/components/Efa2ImportDialog";
import { toast } from "sonner";
import { flushWrites } from "../_common/database/writeQueue";

const OnboardingFormSchema = z.object({
  clubPassword: z.string().min(1),
  boats: z.string().optional(),
  rowers: z.string().optional(),
  routes: z.string().optional(),
});

type OnboardingFormValues = z.infer<typeof OnboardingFormSchema>;

export const OnboardingScreen = ({
  setIsOnboardingDone,
  setPage,
}: {
  setIsOnboardingDone: (isOnboardingDone: boolean) => void;
  setPage: (page: AdminPage) => void;
}) => {
  const { t } = useTranslation();
  const { setClubOverview } = useClubOverviewStore();

  const form = useForm<OnboardingFormValues>({
    resolver: zodResolver(OnboardingFormSchema),
    defaultValues: { clubPassword: "", boats: "", rowers: "", routes: "" },
  });

  const [isSavingClub, setIsSavingClub] = useState(false);
  const isSaving = useRef(false);
  const [profile, setProfile] = useState<OnboardingProfile>("simple");
  const setEnabledModules = useModulesStore((state) => state.setEnabled);
  const [efaProject, setEfaProject] = useState<Efa2Project | null>(null);
  const [confirmEfaImport, setConfirmEfaImport] = useState(false);
  const [clubPassword, setClubPassword] = useState("");
  const isEfaImport = profile === "efaImport";

  return (
    <div className="min-h-screen flex flex-col relative">
      <header className="bg-gradient-to-r from-steel-blue-800 to-steel-blue-700 py-6 px-6 relative">
        <div className="m-auto max-w-screen-sm flex gap-4">
          <div className="w-full">
            <h1 className="text-gray-100 mb-[0.2rem] text-lg font-semibold leading-none tracking-tight text-center w-full">
              {t("onboarding.title")}
            </h1>
          </div>
        </div>
      </header>

      <main className="max-w-screen-lg m-auto flex-1 w-full py-6">
        <form
          className="flex flex-col gap-6"
          onSubmit={form.handleSubmit(
            async (values) => {
              if (isEfaImport) {
                if (!efaProject) {
                  await windowAlert(t("onboarding.efa.required"));
                  return;
                }
                setClubPassword(values.clubPassword);
                setConfirmEfaImport(true);
                return;
              }
              // A second click would save a second club with new ids.
              if (isSaving.current) return;
              isSaving.current = true;
              setIsSavingClub(true);
              const saved = await setClubOverview(formatFormValues(values));
              isSaving.current = false;
              setIsSavingClub(false);
              if (!saved) return;
              setEnabledModules(getModulesForProfile(profile));
              setIsOnboardingDone(true);
              setPage("boathouse");
            },
            () => void windowAlert(t("onboarding.passwordRequired"))
          )}
        >
          <TryDemoCard disabled={isSavingClub} />

          <ProfileChooser profile={profile} setProfile={setProfile} />

          <section className="bg-white rounded-lg p-6 flex flex-col gap-6 flex-1">
            <div>
              <Label className="flex flex-col mb-1">
                {t("onboarding.password")}
                <span className="text-xs text-gray-500 font-normal mt-1">
                  {t("onboarding.passwordHelp")}
                </span>
              </Label>
              <FormField
                control={form.control}
                name="clubPassword"
                render={({ field }) => <Input type="password" {...field} />}
              />
            </div>
          </section>

          {isEfaImport ? (
            <EfaProjectChooser
              project={efaProject}
              setProject={setEfaProject}
            />
          ) : (
            <div className="flex w-full gap-6">
              <div className="flex-1 flex flex-col gap-6">
                <section className="bg-white rounded-lg p-6 flex flex-col gap-6 flex-1">
                  <div>
                    <Label className="flex flex-col mb-1">
                      {t("onboarding.boats")}
                      <span className="text-xs text-gray-500 font-normal mt-1">
                        {t("onboarding.boatsHelp")}
                      </span>
                    </Label>
                    <FormField
                      control={form.control}
                      name="boats"
                      render={({ field }) => (
                        <textarea
                          className="resize-y w-full text-xs input placeholder:text-gray-400 font-mono"
                          rows={13}
                          placeholder={t("onboarding.boatsPlaceholder")}
                          {...field}
                        />
                      )}
                    />
                  </div>
                </section>

                <section className="bg-white rounded-lg p-6 flex flex-col gap-6 flex-1">
                  <div>
                    <Label className="flex flex-col mb-1">
                      {t("onboarding.routes")}
                      <span className="text-xs text-gray-500 font-normal mt-1">
                        {t("onboarding.routesHelp")}
                      </span>
                    </Label>
                    <FormField
                      control={form.control}
                      name="routes"
                      render={({ field }) => (
                        <textarea
                          className="resize-y w-full text-xs input placeholder:text-gray-200 font-mono"
                          rows={3}
                          {...field}
                        />
                      )}
                    />
                  </div>
                </section>
              </div>
              <div className="flex-1 flex flex-col gap-6">
                <section className="bg-white rounded-lg p-6 flex flex-col gap-6 flex-1">
                  <div>
                    <Label className="flex flex-col mb-1">
                      {t("onboarding.rowers")}
                      <span className="text-xs text-gray-500 font-normal mt-1">
                        {t("onboarding.rowersHelp")}
                      </span>
                    </Label>
                    <FormField
                      control={form.control}
                      name="rowers"
                      render={({ field }) => (
                        <textarea
                          className="resize-y w-full text-xs input placeholder:text-gray-200 font-mono"
                          rows={25}
                          {...field}
                        />
                      )}
                    />
                  </div>
                </section>
              </div>
            </div>
          )}
          <Button
            type="submit"
            loading={isSavingClub}
            className="flex items-center justify-center mb-8"
          >
            {isEfaImport
              ? t("onboarding.efa.confirm")
              : t("onboarding.validate")}
            <Check className="ml-2 h-5"></Check>
          </Button>
        </form>

        <Efa2ImportDialog
          project={confirmEfaImport ? efaProject : null}
          confirmLabel={t("onboarding.efa.confirm")}
          onClose={() => setConfirmEfaImport(false)}
          beforeImport={async () => {
            // Saved before the import, which keeps settings (ADR 0004).
            // The explicit "not done" keeps the onboarding after a failed
            // import, although the club now has a password.
            setIsOnboardingDone(false);
            const saved = await setClubOverview({
              club: { password: hashPassword(clubPassword) },
              boats: [],
              rowers: [],
              routes: [],
            });
            if (!saved) return false;
            setEnabledModules([]);
            await flushWrites();
            return true;
          }}
          onImported={() => {
            setIsOnboardingDone(true);
            // The flag is saved in SQLite: wait for it before reloading.
            void flushWrites().then(() => window.location.reload());
          }}
        />
      </main>
    </div>
  );
};

const PROFILES: { id: OnboardingProfile; isAvailable: boolean }[] = [
  { id: "simple", isAvailable: true },
  { id: "fullClub", isAvailable: true },
  { id: "efaImport", isAvailable: true },
];

const ProfileChooser = ({
  profile,
  setProfile,
}: {
  profile: OnboardingProfile;
  setProfile: (profile: OnboardingProfile) => void;
}) => {
  const { t } = useTranslation();

  return (
    <section className="bg-white rounded-lg p-6 flex flex-col gap-4">
      <Label className="flex flex-col">
        {t("onboarding.profile.title")}
        <span className="text-xs text-gray-500 font-normal mt-1">
          {t("onboarding.profile.help")}
        </span>
      </Label>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {PROFILES.map(({ id, isAvailable }) => (
          <button
            key={id}
            type="button"
            disabled={!isAvailable}
            onClick={() => setProfile(id)}
            className={
              "text-left border rounded-lg p-4 flex flex-col gap-1 disabled:opacity-50 disabled:cursor-not-allowed" +
              (profile === id
                ? " border-steel-blue-700 ring-2 ring-steel-blue-700 bg-steel-blue-50"
                : " hover:bg-gray-50")
            }
          >
            <span className="font-semibold text-gray-900">
              {t(`onboarding.profile.${id}.name`)}
            </span>
            <span className="text-sm text-gray-600">
              {t(`onboarding.profile.${id}.description`)}
            </span>
          </button>
        ))}
      </div>
    </section>
  );
};

const EfaProjectChooser = ({
  project,
  setProject,
}: {
  project: Efa2Project | null;
  setProject: (project: Efa2Project) => void;
}) => {
  const { t } = useTranslation();
  const [isReading, setIsReading] = useState(false);

  const read = async (source: "zip" | "folder") => {
    try {
      setIsReading(true);
      const picked = await pickEfa2Project(source);
      if (picked) setProject(picked);
    } catch (error) {
      console.error(error);
      toast.error(efa2ReadErrorMessage(error));
    } finally {
      setIsReading(false);
    }
  };

  return (
    <section className="bg-white rounded-lg p-6 flex flex-col gap-4">
      <Label className="flex flex-col">
        {t("onboarding.efa.title")}
        <span className="text-xs text-gray-500 font-normal mt-1">
          {t("onboarding.efa.help")}
        </span>
      </Label>
      <div className="flex gap-2 flex-wrap">
        <Button type="button" loading={isReading} onClick={() => read("zip")}>
          {t("efa2.chooseZip")}
        </Button>
        <Button
          type="button"
          variant="outlined"
          loading={isReading}
          onClick={() => read("folder")}
        >
          {t("efa2.chooseFolder")}
        </Button>
      </div>
      {project && (
        <p className="text-gray-900">
          {t("onboarding.efa.chosen", { name: project.name })}
        </p>
      )}
    </section>
  );
};

/** One name per line; blank lines are ignored. */
const toNames = (text: string | undefined) =>
  (text ?? "")
    .split("\n")
    .map((name) => name.trim())
    .filter(Boolean);

const formatFormValues = (values: OnboardingFormValues) => {
  return {
    club: {
      password: hashPassword(values.clubPassword),
    },
    boats: toNames(values.boats).map((name) => ({
      id: generateBoatId(),
      name,
    })),
    rowers: toNames(values.rowers).map((name) => ({
      id: generateRowerId(),
      name,
    })),
    routes: toNames(values.routes).map((name) => ({
      id: generateRoutesId(),
      name,
      type: BoatTypeEnum.OTHER,
    })),
  };
};
