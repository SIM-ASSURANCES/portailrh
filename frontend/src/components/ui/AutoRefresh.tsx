'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

export function AutoRefresh() {
  const router = useRouter();

  useEffect(() => {
    const eventSource = new EventSource('/api/pointage/stream');

    eventSource.addEventListener('refresh', () => {
      console.log('Mise à jour des données de pointage reçue (Push), rafraîchissement...');
      router.refresh();
    });

    eventSource.onerror = () => {
      // Le navigateur tentera automatiquement de se reconnecter
      console.log('Connexion au flux en temps réel interrompue, reconnexion...');
    };

    return () => {
      eventSource.close();
    };
  }, [router]);

  return null;
}

