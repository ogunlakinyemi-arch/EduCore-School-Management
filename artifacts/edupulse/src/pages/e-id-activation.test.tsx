import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  extractEidCardDetails, normalizeDevices, normalizeEidRecord, normalizeSchools, normalizeStudents,
} from './e-id-activation';

const activationSource = readFileSync(new URL('./e-id-activation.tsx', import.meta.url), 'utf8');
const appSource = readFileSync(new URL('../App.tsx', import.meta.url), 'utf8');
const sharedSource = readFileSync(new URL('../components/shared.tsx', import.meta.url), 'utf8');

describe('NFC activation response contracts', () => {
  it('normalizes authorized schools and linked device/student records', () => {
    expect(normalizeSchools([{ id: 12, name: 'North School' }])).toEqual([{ id: 12, name: 'North School' }]);
    expect(normalizeDevices([{ id: 5, name: 'Main Gate Reader', serialNumber: 'HW-123', deviceType: 'HYBRID' }]))
      .toEqual([{ id: 5, name: 'Main Gate Reader', serialNumber: 'HW-123', deviceType: 'HYBRID' }]);
    expect(normalizeStudents([{ id: 48, firstName: 'Amina', lastName: 'Okafor', admissionNo: 'ADM-48', className: 'Year 4', section: 'B' }]))
      .toEqual([{ id: 48, firstName: 'Amina', lastName: 'Okafor', admissionNo: 'ADM-48', className: 'Year 4', section: 'B' }]);
  });

  it('fails explicitly rather than rendering malformed or missing API resources as empty results', () => {
    expect(() => normalizeSchools({})).toThrow(/invalid school list response/i);
    expect(() => normalizeDevices([{ id: 1, name: 'Reader' }])).toThrow(/invalid device record/i);
    expect(() => normalizeStudents([{ id: 1, firstName: 'Amina' }])).toThrow(/invalid student record/i);
  });

  it('extracts the newest persisted student photo, school, and NFC card for the e-ID preview', () => {
    const record = normalizeEidRecord({
      student: { id: 48, firstName: 'Amina', lastName: 'Okafor', photoUrl: '/private/photo-new.webp', className: 'Year 4', section: 'B' },
      school: { name: 'North School', logoUrl: '/school/logo.svg' },
      card: { cardNumber: 'CARD-0099' },
    });
    expect(extractEidCardDetails(record)).toMatchObject({
      fullName: 'Amina Okafor',
      photo: '/private/photo-new.webp',
      schoolName: 'North School',
      logo: '/school/logo.svg',
      cardNumber: 'CARD-0099',
    });
    expect(() => normalizeEidRecord({ data: {} })).toThrow(/without student information/i);
    expect(extractEidCardDetails({
      schoolId: 12, studentId: 48, firstName: 'Amina', lastName: 'Okafor',
      schoolName: 'North School', schoolLogo: '/school/logo.svg',
      photo: '/objects/student-photos/12/48/2be587ca-3172-4db9-bcec-e20e81eacfd5',
      cardNumber: 'CARD-0099',
    })).toMatchObject({
      logo: '/school/logo.svg',
      photo: '/api/students/48/photo?schoolId=12',
      cardNumber: 'CARD-0099',
    });
  });
});

describe('restricted activation officer flow', () => {
  it('limits an active officer session to activation and activation history routes', () => {
    expect(appSource).toContain("(role.role as string) === 'DEVICE_ACTIVATION_OFFICER' && role.status === 'ACTIVE'");
    expect(appSource).toContain('<Route path="/activation/history" component={ActivationHistoryPage} />');
    expect(appSource).toContain('<Route path="/activation" component={EidActivationPage} />');
    expect(appSource).toContain('<Route><Redirect to="/activation" /></Route>');
    expect(appSource).toContain('if (isActivationOfficer || isCompanyAccountant) return <ProtectedRoutes />;');
  });

  it('gives the officer only the two activation navigation links and no settings link', () => {
    expect(sharedSource).toContain("if (isActivationOfficer) return item.roles?.includes('DEVICE_ACTIVATION_OFFICER') === true;");
    expect(sharedSource).toContain("href: '/activation', label: 'Card Activation'");
    expect(sharedSource).toContain("href: '/activation/history', label: 'Activation History'");
    expect(sharedSource).toContain('{!isActivationOfficer && !isCompanyAccountant && <Link href="/settings"');
  });

  it('keeps hardware UID read-only, posts the selected records, and refreshes e-ID data before printing', () => {
    expect(activationSource).toContain('readOnly value={selectedDevice.serialNumber}');
    expect(activationSource).toContain('deviceId: selectedDevice.id, studentId: selectedStudent.id, cardNumber: cardNumber.trim()');
    expect(activationSource).toContain('const fresh = await fetchEid(schoolId, selectedStudent.id);');
    expect(activationSource).toContain('window.print();');
    expect(activationSource).toContain('Generate / Send for Printing');
  });

  it('keeps class, section, and session off the physical activation card while retaining searchable students', () => {
    const printTemplate = activationSource.slice(
      activationSource.indexOf('function EidCardPreview'),
      activationSource.indexOf('export function EidActivationPage'),
    );
    expect(printTemplate).not.toContain('details.className');
    expect(printTemplate).not.toContain('details.section');
    expect(printTemplate).not.toContain('details.session');
    expect(printTemplate).toContain('details.photo');
    expect(activationSource).toContain('data-testid="input-activation-student-search"');
    expect(activationSource).toContain('data-testid="select-activation-student"');
  });
});