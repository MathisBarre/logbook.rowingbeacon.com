import { Label } from "../../../_common/components/Label";
import { Route } from "../../../_common/business/route.rules";

export const defaultRoute: Route = {
  id: "null",
  name: "Aucun parcours",
};

interface RouteSectionProps {
  routes: Route[];
  onChange: (value: { id: string; name: string }) => void;
  value: { id: string; name: string };
}

const RouteSection = ({ routes, onChange, value }: RouteSectionProps) => {
  if (routes.length === 0) return null;

  return (
    <div className="flex flex-col gap-1 flex-1">
      <Label>Parcours</Label>
      <select
        name="route"
        id="route"
        className="input"
        onChange={(event) => {
          const route = routes.find((route) => route.id === event.target.value);

          if (route) {
            onChange(route);
          }
        }}
        value={value.id}
      >
        <option value={defaultRoute.id}>{defaultRoute.name}</option>
        {routes.sort().map((route) => (
          <option key={route.id} value={route.id}>
            {route.name}
          </option>
        ))}
      </select>
    </div>
  );
};

export default RouteSection;
