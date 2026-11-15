import { createContext, useContext, useEffect } from 'react';
import type { ReactNode } from 'react';

export const InspectorContext = createContext<{ publish: (content: ReactNode) => void; show: () => void }>({ publish: () => {}, show: () => {} });
export function useInspector(content: ReactNode) {
  const { publish, show } = useContext(InspectorContext);
  useEffect(() => { publish(content); }, [content, publish]);
  useEffect(() => () => publish(null), [publish]);
  return show;
}
