import { Link } from 'wouter';
import { PageHeading, TenantPicker, useTenant, EmptyState } from '@/components/shared';
import { FolderOpen } from 'lucide-react';

export function RecordsPage() {
  const { schoolId } = useTenant();
  return <div className="fade-up">
    <PageHeading eyebrow="School directory" title="Records" description="View existing school records. Platform Owner access is read-only." action={<TenantPicker />} />
    {!schoolId ? <EmptyState icon={FolderOpen} title="Select a school context" description="Choose a school to view its records." /> :
      <div className="grid gap-4 sm:grid-cols-2">
        {[
          ['/students', 'Student records', 'Select View details / e-ID card in the student directory.'],
          ['/employees', 'Teacher records', 'Existing teacher and employee directory.'],
          ['/parents', 'Parent / guardian records', 'Existing parent directory and linked children.'],
          ['/employees', 'Staff records', 'Existing staff and employment status directory.'],
        ].map(([href, title, description]) => <Link key={title} href={href} className="panel block p-5 hover:underline">
          <h2 className="font-bold">{title}</h2><p className="mt-2 text-sm">{description}</p>
        </Link>)}
      </div>}
  </div>;
}
