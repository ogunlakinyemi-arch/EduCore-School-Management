import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { AudiencePicker, COMMUNITY_AUDIENCES, isAllCommunity } from './audience-picker';
import { formatSchoolDate, CommunityDashboardBody } from './school-community-dashboard';
import { buildDuty, emptyDuty } from './transport-extras';

describe('community UI', () => {
  const data = {
    schoolId: 1, schoolName: 'Fixture school', asOf: '2026-10-23T09:00:00Z',
    closing: { configured: false, date: '2026-10-23', timezone: 'Africa/Lagos',
      time: null, dayOpen: false, effectiveAt: null, revision: 0 },
    notices: [], busDuties: [],
  };
  it('audience picker offers Driver and All community', () => {
    const html = renderToStaticMarkup(<AudiencePicker value={[...COMMUNITY_AUDIENCES]} onChange={() => {}} />);
    expect(html).toContain('All community'); expect(html).toContain('Driver');
    expect(isAllCommunity(['TEACHER'])).toBe(false);
  });
  it('formats dates in school timezone', () => {
    expect(formatSchoolDate('2025-03-04T23:30:00Z', 'Africa/Lagos', true)).toContain('Wed');
    expect(formatSchoolDate('2025-03-04', 'Africa/Lagos')).toContain('4 March');
  });
  it('requires a valid duty period', () => {
    expect(buildDuty(emptyDuty()).error).toBeTruthy();
    expect(buildDuty({ startDate: '2025-03-05', endDate: '2025-03-04', startTime: '07:00', endTime: '08:00', instructions: '' }).error).toBeTruthy();
    expect(buildDuty({ startDate: '2025-03-04', endDate: '2025-03-05', startTime: '07:00', endTime: '08:00', instructions: ' go ' }).duty?.instructions).toBe('go');
  });
  it('shows an explicit unconfigured state, not the operational fallback closing time', () => {
    const html=renderToStaticMarkup(<CommunityDashboardBody d={data} />);
    expect(html).toContain('Closing time is not configured');
    expect(html).not.toContain('School is closed today');
    expect(html).not.toContain('14:00');
    expect(html).toContain('No notices for you');
  });
  it('shows closure and the saved effective timestamp together', () => {
    const html=renderToStaticMarkup(<CommunityDashboardBody d={{...data,closing:{...data.closing,configured:true,effectiveAt:'2026-10-22T10:00:00Z',revision:1}}} />);
    expect(html).toContain('School is closed today');
    expect(html).toContain('closing-effective');
  });
  it('clearly marks cancelled notices and treats instructions as text', () => {
    const html=renderToStaticMarkup(<CommunityDashboardBody d={{...data,
      notices:[{id:1,title:'Cancelled assembly',category:'OTHER',startDate:'2026-10-23',endDate:null,status:'INACTIVE',change:'CANCELLED',changedAt:data.asOf}],
      busDuties:[{id:1,routeId:1,routeName:'Fixture route',busIdentifier:'TEST',role:'TEACHER',status:'ACTIVE',
        duty:{startDate:'2026-10-01',endDate:'2026-10-31',startTime:'07:00',endTime:'16:00',instructions:'<script>unsafe()</script>'}}],
    }} />);
    expect(html).toContain('line-through');
    expect(html).toContain('Cancelled');
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
  });
  it('does not call an undated legacy assignment an active duty', () => {
    const html=renderToStaticMarkup(<CommunityDashboardBody d={{...data,
      busDuties:[{id:1,routeId:1,routeName:'Fixture route',busIdentifier:null,role:'STAFF',status:'PERIOD_NOT_SET',duty:null}],
    }} />);
    expect(html).toContain('Duty period not set');
    expect(html).not.toContain('>Active<');
  });
});
