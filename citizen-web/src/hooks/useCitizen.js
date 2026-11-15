import {
  useCallback,
  useEffect,
  useEffectEvent,
  useRef,
  useState,
} from "react";
import {
  api,
  getNearestShelters,
  getRoute,
  connectCitizen,
} from "../api/client";

export default function useCitizen({ position, selected, profile, lang }) {
  const [snapshot, setSnapshot] = useState({
    districts: [],
    shelters: [],
    roads: [],
  });
  const [nearest, setNearest] = useState([]);
  const [routeResult, setRouteResult] = useState(null);
  const requestKey = JSON.stringify([position, selected, profile, lang]);
  const routeData = routeResult?.key === requestKey ? routeResult.data : null;
  const [loading, setLoading] = useState(true);
  const [dataError, setDataError] = useState(null);
  const [routeError, setRouteError] = useState(null);
  const [connection, setConnection] = useState("connecting");
  const [revision, setRevision] = useState(0);
  const [routeRevision, setRouteRevision] = useState(0);
  const [notice, setNotice] = useState(null);
  const routeVersion = useRef(0);
  const retry = useCallback(() => setRevision((n) => n + 1), []);

  useEffect(() => {
    const controller = new AbortController();
    const load = async () => {
      try {
        const [d, s, r] = await Promise.all([
          api.getDistricts(lang, controller.signal),
          api.getShelters(lang, controller.signal),
          api.getRoads(lang, controller.signal),
        ]);
        if (!controller.signal.aborted) {
          setSnapshot({
            districts: d.items,
            shelters: s.items,
            roads: r.items,
          });
          setDataError(null);
        }
      } catch (error) {
        if (!controller.signal.aborted) setDataError(error);
      }
    };
    load();
    return () => controller.abort();
  }, [lang, revision]);

  useEffect(() => {
    const controller = new AbortController();
    let version;
    const timer = setTimeout(async () => {
      version = ++routeVersion.current;
      setLoading(true);
      setRouteResult(null);
      setRouteError(null);
      try {
        const result = await getNearestShelters(
          position[0],
          position[1],
          3,
          lang,
          controller.signal,
        );
        if (controller.signal.aborted || version !== routeVersion.current)
          return;
        setNearest(result.items);
        // The nearest endpoint is intentionally NOT profile-aware. Let the backend
        // replace an inaccessible target, even when all three nearest are inaccessible.
        const target = selected || result.items[0]?.id;
        if (!target) {
          setRouteResult(null);
          return;
        }
        const route = await getRoute(
          position[0],
          position[1],
          target,
          lang,
          profile,
          controller.signal,
        );
        if (!controller.signal.aborted && version === routeVersion.current) {
          setRouteResult({ data: route, key: requestKey });
          if (route.rerouted)
            setNotice({
              reason: route.reason,
              id: Date.now(),
              key: requestKey,
            });
        }
      } catch (error) {
        if (!controller.signal.aborted && version === routeVersion.current) {
          setRouteError(error);
          setRouteResult(null);
        }
      } finally {
        if (!controller.signal.aborted && version === routeVersion.current)
          setLoading(false);
      }
    }, 250);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [position, selected, profile, lang, revision, routeRevision, requestKey]);

  const onEvent = useEffectEvent((event) => {
    const { type, data } = event;
    if (!data) return;
    if (type === "reroute" && data.route && data.shelter) {
      // Ignore old-profile/origin pushes while a changed route is being registered.
      const start = data.route.path?.[0];
      if (
        !start ||
        Math.abs(start[0] - position[0]) > 0.0001 ||
        Math.abs(start[1] - position[1]) > 0.0001
      )
        return;
      if (
        (profile === "special_needs") !==
        (data.transport === "wheelchair_medical")
      )
        return;
      routeVersion.current++;
      setRouteResult({ data, key: requestKey });
      setRouteError(null);
      setLoading(false);
      setNotice({ reason: data.reason, id: Date.now(), key: requestKey });
      navigator.vibrate?.([150, 80, 150]);
    }
    if (type === "shelter.updated" || type === "road.updated") {
      const key = type === "shelter.updated" ? "shelters" : "roads";
      setSnapshot((old) => ({
        ...old,
        [key]: old[key].some((x) => x.id === data.id)
          ? old[key].map((x) => (x.id === data.id ? data : x))
          : [...old[key], data],
      }));
      if (type === "shelter.updated") {
        setNearest((items) =>
          items.map((item) =>
            item.id === data.id ? { ...item, ...data } : item,
          ),
        );
      }
      // Revalidate even if no reroute can be pushed (e.g. NO_ACCESSIBLE_ROUTE).
      // Do not refetch districts/shelters/roads for every individual live update.
      setRouteRevision((n) => n + 1);
    }
  });
  useEffect(
    () => connectCitizen(lang, onEvent, setConnection, retry),
    [lang, retry],
  );

  return {
    ...snapshot,
    nearest,
    routeData,
    loading,
    dataError,
    routeError,
    connection,
    retry,
    notice: notice?.key === requestKey ? notice : null,
  };
}
