import Button from "../_common/components/Button";
import { Input } from "../_common/components/Input";
import { Label } from "../_common/components/Label";
import { ArrowRightIcon, Check, CircleHelpIcon } from "lucide-react";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { FormField } from "../_common/components/Form";
import { faker } from "@faker-js/faker";
import {
  ClubOverviewStoreState,
  useClubOverviewStore,
} from "../_common/store/clubOverview.store";
import { generateBoatId } from "../_common/business/boat.rules";
import { generateRowerId } from "../_common/business/rower.rules";
import { generateRoutesId } from "../_common/business/route.rules";
import { logStr } from "../_common/utils/utils";
import { windowAlert } from "../_common/utils/window.utils";
import { BoatTypeEnum } from "../_common/types/boat.type";

const OnboardingFormSchema = z.object({
  clubPassword: z.string(),
  boats: z.string(),
  rowers: z.string(),
  routes: z.string(),
});

type OnboardingFormValues = z.infer<typeof OnboardingFormSchema>;

export const Onboarding = ({
  setIsOnboardingDone,
}: {
  setIsOnboardingDone: (isOnboardingDone: boolean) => void;
}) => {
  const { setClubOverview } = useClubOverviewStore();

  const form = useForm<OnboardingFormValues>({
    resolver: zodResolver(OnboardingFormSchema),
  });

  const onboard = (values: ClubOverviewStoreState["clubOverview"]) => {
    setClubOverview(values);
    setIsOnboardingDone(true);
  };

  return (
    <div className="min-h-screen flex flex-col relative">
      <header className="bg-gradient-to-r from-steel-blue-800 to-steel-blue-700 py-6 px-6 relative">
        <div className="m-auto max-w-screen-sm flex gap-4">
          <div className="w-full">
            <h1 className="text-gray-100 mb-[0.2rem] text-lg font-semibold leading-none tracking-tight text-center w-full">
              Configurez votre application
            </h1>
          </div>
        </div>
      </header>

      <main className="max-w-screen-lg m-auto flex-1 w-full py-6">
        <form
          className="flex flex-col gap-6"
          onSubmit={form.handleSubmit((values) => {
            onboard(formatFormValues(values));
          })}
        >
          <article className="flex flex-col gap-1 items-start bg-blue-100 border-l-4 border-blue-500 p-4 rounded text-blue-950 my-4">
            <div className="flex gap-2 items-center">
              <CircleHelpIcon className="color-blue-500 h-5 w-5" />

              <div>
                <h5 className="text-base font-medium">
                  Souhaitez-vous juste tester RowingBeacon ?
                </h5>
              </div>
            </div>
            <p className="text-sm ">
              Si vous souhaitez simplement tester l'application, vous pouvez
              activer le mode démo pour utiliser des données fictives.
            </p>
            <Button
              variant="outlined"
              type="button"
              className="flex items-center gap-2 text-sm mt-1"
              onClick={async () => {
                const ADMIN_PASSWORD = "admin";
                onboard({
                  club: {
                    password: ADMIN_PASSWORD,
                  },
                  boats: generateBoats(),
                  rowers: generateRowers(30),
                  routes: generateRoutes(3),
                });
                await windowAlert(
                  `Le mot de passe admin du mode démo est "${ADMIN_PASSWORD}"`
                );
              }}
            >
              Lancer l'application en mode démo
              <ArrowRightIcon className="h-4 w-4" />
            </Button>
          </article>

          <section className="bg-white rounded-lg p-6 flex flex-col gap-6 flex-1">
            <div>
              <Label className="flex flex-col mb-1">
                Mot de passe
                <span className="text-xs text-gray-500 font-normal mt-1">
                  Le mot de passe sera utile pour protéger les actions
                  sensibles. Vous pouvez le laisser vide si vous ne souhaitez
                  pas mettre en place de protection.
                </span>
              </Label>
              <FormField
                control={form.control}
                name="clubPassword"
                render={({ field }) => <Input type="password" {...field} />}
              />
            </div>
          </section>

          <div className="flex w-full gap-6">
            <div className="flex-1 flex flex-col gap-6">
              <section className="bg-white rounded-lg p-6 flex flex-col gap-6 flex-1">
                <div>
                  <Label className="flex flex-col mb-1">
                    Bateaux
                    <span className="text-xs text-gray-500 font-normal mt-1">
                      Entrez le nom de vos bateaux, un par ligne
                    </span>
                  </Label>
                  <FormField
                    control={form.control}
                    name="boats"
                    render={({ field }) => (
                      <textarea
                        className="resize-y w-full text-xs input placeholder:text-gray-400 font-mono"
                        rows={13}
                        placeholder={logStr`
                          Example: 
                          100 Swift
                          101 Hudson
                          102 WinTech
                          103 Empacher
                          104 Vespoli
                          105 Swift
                          106 WinTech
                          200 Hudson
                          201 WinTech
                          202 Hudson
                          203 Vespoli
                          401 Hudson
                          402 WinTech
                          800 Filippi
                    `}
                        {...field}
                      />
                    )}
                  />
                </div>
              </section>

              <section className="bg-white rounded-lg p-6 flex flex-col gap-6 flex-1">
                <div>
                  <Label className="flex flex-col mb-1">
                    Parcours
                    <span className="text-xs text-gray-500 font-normal mt-1">
                      Entrez le nom de vos parcours, un par ligne
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
                    Rameurs
                    <span className="text-xs text-gray-500 font-normal mt-1">
                      Entrez le nom de vos rameurs, un par ligne
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
          <Button
            type="submit"
            className="flex items-center justify-center mb-8"
          >
            Valider les informations
            <Check className="ml-2 h-5"></Check>
          </Button>
        </form>
      </main>
    </div>
  );
};

const formatFormValues = (values: OnboardingFormValues) => {
  return {
    club: {
      name: "NO_NAME",
      address: "NO_ADDRESS",
      password: values.clubPassword,
    },
    boats: values.boats.split("\n").map((boat) => ({
      id: generateBoatId(),
      name: boat.trim(),
    })),
    rowers: values.rowers.split("\n").map((rower) => ({
      id: generateRowerId(),
      name: rower.trim(),
    })),
    routes: values.routes.split("\n").map((route) => ({
      id: generateRoutesId(),
      name: route.trim(),
    })),
  };
};

const generateRowers = (nbOfRowers: number) => {
  return Array.from({ length: nbOfRowers }, () => ({
    id: generateRowerId(),
    name: faker.person.fullName(),
  }));
};

const generateBoats = () => {
  let last1xBoatGenerated = 100;
  let last2xBoatGenerated = 200;
  let last4xBoatGenerated = 400;
  let last8xBoatGenerated = 800;

  const nbOfBoats = 38;
  let i = 0;
  return Array.from({ length: nbOfBoats }, () => {
    const shouldGenerate1x = i >= 0 && i < 20;
    const shouldGenerate2x = i >= 20 && i < 30;
    const shouldGenerate4x = i >= 30 && i < 35;
    const shouldGenerate8x = i >= 35 && i < 38;

    const rowingBrands = [
      "Hudson",
      "Filippi",
      "Empacher",
      "Vespoli",
      "Swift",
      "WinTech",
    ];

    let name = "";
    let type = BoatTypeEnum.OTHER;

    if (shouldGenerate1x) {
      name = `${last1xBoatGenerated++} ${
        rowingBrands[generateNumberBetween(0, rowingBrands.length - 1)]
      }`;
      type = BoatTypeEnum.ONE_ROWER_COXLESS;
    }

    if (shouldGenerate2x) {
      name = `${last2xBoatGenerated++} ${
        rowingBrands[generateNumberBetween(0, rowingBrands.length - 1)]
      }`;
      type = BoatTypeEnum.TWO_ROWERS_COXLESS;
    }

    if (shouldGenerate4x) {
      name = `${last4xBoatGenerated++} ${
        rowingBrands[generateNumberBetween(0, rowingBrands.length - 1)]
      }`;
      type = BoatTypeEnum.FOUR_ROWERS_COXLESS;
    }

    if (shouldGenerate8x) {
      name = `${last8xBoatGenerated++} ${
        rowingBrands[generateNumberBetween(0, rowingBrands.length - 1)]
      }`;
      type = BoatTypeEnum.EIGHT_ROWERS_COXED;
    }

    i++;

    return {
      id: generateBoatId(),
      name,
      type,
    };
  }).sort();
};

const generateNumberBetween = (min: number, max: number) => {
  return Math.floor(Math.random() * (max - min + 1)) + min;
};

const generateRoutes = (nbOfRoutes: number) => {
  return Array.from({ length: nbOfRoutes }, () => ({
    id: generateRoutesId(),
    name: faker.location.street(),
  }));
};
