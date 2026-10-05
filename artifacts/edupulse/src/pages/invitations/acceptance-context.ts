export type InvitationContext = {
  ticket: string | null;
  partnerToken: string | null;
  internalEmployeeInvitation?: string;
};

const AUTH_FLOW_STORAGE_KEY = 'edupulse:invitation-auth-flow';
const AUTH_FLOW_MAX_AGE_MS = 15 * 60 * 1000;

type InvitationAuthFlow = 'signup' | 'signin';

function ticketFingerprint(ticket: string): string {
  let left = 0x811c9dc5;
  let right = 0x9e3779b9;
  for (let index = 0; index < ticket.length; index += 1) {
    const code = ticket.charCodeAt(index);
    left = Math.imul(left ^ code, 0x01000193);
    right = Math.imul(right ^ code, 0x85ebca6b);
  }
  return `${(left >>> 0).toString(16)}${(right >>> 0).toString(16)}`;
}

export function setInvitationAuthFlow(ticket: string, flow: InvitationAuthFlow): void {
  if (typeof window === 'undefined') return;
  try {
    window.sessionStorage.setItem(AUTH_FLOW_STORAGE_KEY, JSON.stringify({
      ticketFingerprint: ticketFingerprint(ticket),
      flow,
      createdAt: Date.now(),
    }));
  } catch {
    // If browser storage is unavailable, acceptance uses the signed-in baseline check.
  }
}

export function consumeInvitationAuthFlow(ticket: string): InvitationAuthFlow | null {
  if (typeof window === 'undefined') return null;
  let stored: string | null;
  try {
    stored = window.sessionStorage.getItem(AUTH_FLOW_STORAGE_KEY);
    window.sessionStorage.removeItem(AUTH_FLOW_STORAGE_KEY);
  } catch {
    return null;
  }
  if (!stored) return null;

  try {
    const marker = JSON.parse(stored) as {
      ticketFingerprint?: string;
      flow?: InvitationAuthFlow;
      createdAt?: number;
    };
    if (
      marker.ticketFingerprint !== ticketFingerprint(ticket) ||
      (marker.flow !== 'signup' && marker.flow !== 'signin') ||
      typeof marker.createdAt !== 'number' ||
      Date.now() - marker.createdAt < 0 ||
      Date.now() - marker.createdAt > AUTH_FLOW_MAX_AGE_MS
    ) return null;
    return marker.flow;
  } catch {
    return null;
  }
}

export function readInvitationContext(search: string): InvitationContext {
  const params = new URLSearchParams(search);
  return {
    ticket: params.get('__clerk_ticket') || null,
    partnerToken: params.get('partnerInvitation') || null,
    ...(params.get('internalEmployeeInvitation')
      ? {internalEmployeeInvitation:params.get('internalEmployeeInvitation')!}
      : {}),
  };
}

export function invitationReturnUrl(
  context: InvitationContext,
  basePath = '',
): string {
  const params = new URLSearchParams();
  if (context.ticket) params.set('__clerk_ticket', context.ticket);
  if (context.partnerToken) params.set('partnerInvitation', context.partnerToken);
  if(context.internalEmployeeInvitation) params.set('internalEmployeeInvitation',context.internalEmployeeInvitation);
  const query = params.toString();
  return `${basePath}/accept-invitation${query ? `?${query}` : ''}`;
}

type AuthorizedRole = {
  role?: string;
  status?: string;
  schoolId?: number | null;
};

type AuthorizedContext = {
  isPlatformOwner?: boolean;
  roles?: AuthorizedRole[] | null;
};

export function destinationForAuthorizedContext(
  context: AuthorizedContext | null | undefined,
): string | null {
  if (!context) return null;
  if (context.isPlatformOwner) return '/';

  const activeRoles = new Set(
    context.roles
      ?.filter((role) => role.status === 'ACTIVE')
      .map((role) => role.role)
      .filter((role): role is string => Boolean(role)) ?? [],
  );

  if (
    activeRoles.has('SCHOOL_ADMIN') ||
    activeRoles.has('STUDENT') ||
    activeRoles.has('TEACHER') ||
    activeRoles.has('ACCOUNTANT') ||
    activeRoles.has('STAFF')
  ) return '/';
  if (activeRoles.has('PARENT')) return '/parent';
  if (activeRoles.has('PARTNER')) return '/partner';
  if (activeRoles.has('COMPANY_ACCOUNTANT')) return '/company-finance';
  if (activeRoles.has('DEVICE_ACTIVATION_OFFICER')) return '/activation';
  return null;
}

export function destinationForNewlyActivatedRole(
  previous: AuthorizedContext | null | undefined,
  fresh: AuthorizedContext | null | undefined,
): string | null {
  if (!fresh) return null;
  if (!previous?.isPlatformOwner && fresh.isPlatformOwner) return '/';

  const previousActiveAssignments = new Set(
    previous?.roles
      ?.filter((role) => role.status === 'ACTIVE')
      .map((role) => `${role.role}:${role.schoolId ?? ''}`) ?? [],
  );
  const newlyActiveRoles = fresh.roles?.filter(
    (role) => role.status === 'ACTIVE' &&
      !previousActiveAssignments.has(`${role.role}:${role.schoolId ?? ''}`),
  ) ?? [];
  return destinationForAuthorizedContext({
    ...fresh,
    isPlatformOwner: false,
    roles: newlyActiveRoles,
  });
}