import { useSyncExternalStore } from 'react';
import { lerEstadoSync, ouvirEstadoSync, type EstadoSync } from './sincronizacao';

/** Estado da sincronização para as telas, sempre atualizado. */
export function useEstadoSincronizacao(): EstadoSync {
  return useSyncExternalStore(ouvirEstadoSync, lerEstadoSync, lerEstadoSync);
}
