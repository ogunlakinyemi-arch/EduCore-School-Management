import { useEffect, useState } from 'react';
import { isNativePwaInstallEligible } from '@/lib/pwa';

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
};

function isStandalone(): boolean {
  return window.matchMedia('(display-mode: standalone)').matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true;
}

function isAppleMobileDevice(): boolean {
  return /iPhone|iPad|iPod/i.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

export function PwaInstall() {
  const [installPrompt, setInstallPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [installed, setInstalled] = useState(false);
  const [ios, setIos] = useState(false);

  useEffect(() => {
    setInstalled(isStandalone());
    setIos(isAppleMobileDevice());

    const onBeforeInstallPrompt = (event: Event) => {
      event.preventDefault();
      setInstallPrompt(event as BeforeInstallPromptEvent);
    };
    const onAppInstalled = () => {
      setInstalled(true);
      setInstallPrompt(null);
    };

    window.addEventListener('beforeinstallprompt', onBeforeInstallPrompt);
    window.addEventListener('appinstalled', onAppInstalled);
    return () => {
      window.removeEventListener('beforeinstallprompt', onBeforeInstallPrompt);
      window.removeEventListener('appinstalled', onAppInstalled);
    };
  }, []);

  const canInstall = isNativePwaInstallEligible({
    hasInstallPrompt: installPrompt !== null,
    isInstalled: installed,
  });

  if (installed) return null;
  if (canInstall && installPrompt) {
    return (
      <button
        type="button"
        className="inline-flex min-h-11 items-center justify-center rounded-xl bg-[hsl(var(--accent))] px-4 py-2 text-sm font-semibold text-[hsl(var(--accent-foreground))] hover:opacity-90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
        onClick={async () => {
          const prompt = installPrompt;
          setInstallPrompt(null);
          await prompt.prompt();
          await prompt.userChoice;
        }}
        aria-label="Install EduCore"
      >
        Install EduCore
      </button>
    );
  }

  if (ios) {
    return (
      <details className="max-w-sm text-sm text-[hsl(var(--muted-foreground))]">
        <summary className="min-h-11 cursor-pointer content-center font-medium text-[hsl(var(--foreground))]">
          Add EduCore to your Home Screen
        </summary>
        <p className="mt-1 leading-5">
          On iPhone or iPad, open this page in Safari, tap Share, then choose “Add to Home Screen.”
        </p>
      </details>
    );
  }

  return null;
}