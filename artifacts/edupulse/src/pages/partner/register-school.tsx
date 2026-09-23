import { useState } from 'react';
import { useLocation } from 'wouter';
import { useValidatePartnerReferral, useOnboardSchoolThroughPartnerReferral } from '@workspace/api-client-react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { zodResolver } from '@hookform/resolvers/zod';
import { Button, Field, cx } from '@/components/shared';
import { Building2, CheckCircle2, ChevronRight, GraduationCap, Zap, AlertCircle } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';

const onboardSchema = z.object({
  referralToken: z.string().min(16),
  school: z.object({
    code: z.string().min(1, "School Code is required"),
    name: z.string().min(2, "School Name is required"),
    city: z.string().min(2, "City is required"),
    state: z.string().min(2, "State is required"),
    email: z.string().email("Valid email is required").optional().or(z.literal('')),
    phone: z.string().optional().or(z.literal('')),
  })
});

export default function RegisterSchool() {
  const [location] = useLocation();
  const searchParams = new URLSearchParams(window.location.search);
  const refToken = searchParams.get('ref');
  
  const validate = useValidatePartnerReferral();
  const onboard = useOnboardSchoolThroughPartnerReferral();
  const { toast } = useToast();
  
  const [validatedPartner, setValidatedPartner] = useState<{ code: string } | null>(null);
  const [isValidating, setIsValidating] = useState(false);
  const [validationError, setValidationError] = useState('');
  const [success, setSuccess] = useState(false);

  const form = useForm<z.infer<typeof onboardSchema>>({
    resolver: zodResolver(onboardSchema),
    defaultValues: {
      referralToken: refToken || '',
      school: {
        code: '',
        name: '',
        city: '',
        state: '',
        email: '',
        phone: ''
      }
    }
  });

  const handleValidate = async () => {
    const token = form.getValues('referralToken');
    if (!token) {
      setValidationError("Referral code is required");
      return;
    }
    
    setIsValidating(true);
    setValidationError('');
    
    try {
      validate.mutate({ data: { referralToken: token } }, {
        onSuccess: (data: any) => {
          if (data && data.valid && data.partnerCode) {
            setValidatedPartner({
              code: data.partnerCode
            });
            toast({ title: "Referral applied", description: `Referred by partner code ${data.partnerCode}` });
          } else {
            setValidationError("Invalid or expired referral code");
          }
          setIsValidating(false);
        },
        onError: (err: any) => {
          setValidationError(err.error || "Invalid or expired referral code");
          setIsValidating(false);
        }
      });
    } catch (e) {
      setValidationError("Failed to validate code");
      setIsValidating(false);
    }
  };

  const onSubmit = form.handleSubmit((data) => {
    if (!validatedPartner) {
      setValidationError("Please validate your referral code first");
      return;
    }
    
    onboard.mutate({ data }, {
      onSuccess: () => {
        setSuccess(true);
      },
      onError: (err: any) => {
        toast({ title: "Registration failed", description: err.error || "An error occurred", variant: "destructive" });
      }
    });
  });

  if (success) {
    return (
      <main className="min-h-[100dvh] bg-[hsl(var(--background))] p-4 flex items-center justify-center">
        <div className="panel p-8 md:p-12 text-center max-w-lg w-full fade-up">
          <div className="mx-auto grid h-16 w-16 place-items-center rounded-full bg-[hsl(157_37%_43%/.15)] text-[hsl(157_37%_43%)] dark:text-[hsl(157_37%_55%)] mb-6">
            <CheckCircle2 size={32} />
          </div>
          <h1 className="display-font text-3xl font-bold mb-3">School Registered</h1>
          <p className="text-[hsl(var(--muted-foreground))] mb-8 leading-relaxed">
            Your school has been successfully registered on EduPulse via your partner's referral.
          </p>
          <Button className="w-full" onClick={() => window.location.href = '/sign-in'}>
            Continue to Sign In
          </Button>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-[100dvh] bg-[hsl(var(--background))] p-4 md:p-8 flex items-center justify-center">
      <div className="w-full max-w-5xl grid md:grid-cols-[1fr_1.2fr] gap-8 bg-[hsl(var(--card))] rounded-[28px] border border-[hsl(var(--border))] shadow-xl overflow-hidden min-h-[600px]">
        
        <div className="bg-[hsl(var(--sidebar))] p-8 md:p-12 text-[hsl(var(--sidebar-foreground))] flex flex-col justify-between">
          <div>
            <div className="flex items-center gap-3 mb-12">
              <span className="grid h-10 w-10 place-items-center rounded-xl bg-[hsl(var(--accent))] text-[hsl(var(--accent-foreground))]">
                <Zap size={20} />
              </span>
              <span className="display-font text-xl font-bold">EduPulse</span>
            </div>
            
            <h1 className="display-font text-4xl font-bold leading-tight mb-4">
              Join the trusted school operations platform.
            </h1>
            <p className="text-[hsl(var(--sidebar-foreground)/.7)] leading-relaxed mb-8">
              Register your institution to get started. You've been referred by a partner to join our network.
            </p>
          </div>
          
          <div className="space-y-4">
            <div className="flex items-center gap-3 text-sm font-semibold">
              <div className="h-8 w-8 rounded-lg bg-[hsl(var(--sidebar-primary)/.2)] text-[hsl(var(--sidebar-primary-foreground))] flex items-center justify-center"><Building2 size={16} /></div>
              Complete tenant isolation
            </div>
            <div className="flex items-center gap-3 text-sm font-semibold">
              <div className="h-8 w-8 rounded-lg bg-[hsl(var(--sidebar-primary)/.2)] text-[hsl(var(--sidebar-primary-foreground))] flex items-center justify-center"><GraduationCap size={16} /></div>
              Seamless academic tracking
            </div>
          </div>
        </div>

        <div className="p-8 md:p-12 flex flex-col justify-center">
          <div className="eyebrow mb-2">School Registration</div>
          <h2 className="display-font text-2xl font-bold mb-6">Create your school account</h2>

          <form onSubmit={onSubmit} className="space-y-6">
            {!validatedPartner ? (
              <div className="p-5 rounded-2xl border-2 border-dashed border-[hsl(var(--border))] bg-[hsl(var(--muted)/.3)]">
                <Field label="Referral Code" error={validationError}>
                  <div className="flex gap-3">
                    <input 
                      {...form.register('referralToken')} 
                      placeholder="Enter the 16+ character code" 
                      className="font-mono bg-[hsl(var(--card))]"
                    />
                    <Button 
                      type="button" 
                      onClick={handleValidate}
                      disabled={isValidating || !form.watch('referralToken')}
                    >
                      {isValidating ? 'Checking...' : 'Apply Code'}
                    </Button>
                  </div>
                </Field>
              </div>
            ) : (
              <div className="p-4 rounded-xl border border-emerald-500/30 bg-emerald-500/5 flex items-start gap-3">
                <CheckCircle2 className="text-emerald-600 mt-0.5" size={18} />
                <div>
                  <div className="font-bold text-emerald-800 dark:text-emerald-400">Referral Applied</div>
                  <div className="text-sm text-emerald-600 dark:text-emerald-500">
                    Referred by Partner Code: {validatedPartner.code}
                  </div>
                </div>
                <Button 
                  type="button" 
                  variant="quiet" 
                  className="ml-auto h-8 px-2 text-xs" 
                  onClick={() => setValidatedPartner(null)}
                >
                  Change
                </Button>
              </div>
            )}

            {validatedPartner && (
              <div className="space-y-5 animate-in fade-in slide-in-from-bottom-2 duration-300">
                <div className="grid gap-5 md:grid-cols-2">
                  <Field label="School Name" error={form.formState.errors.school?.name?.message}>
                    <input {...form.register('school.name')} placeholder="e.g. Excellence Academy" />
                  </Field>
                  <Field label="School Code (Short)" error={form.formState.errors.school?.code?.message}>
                    <input {...form.register('school.code')} placeholder="e.g. EXC" className="uppercase" />
                  </Field>
                </div>
                
                <div className="grid gap-5 md:grid-cols-2">
                  <Field label="City" error={form.formState.errors.school?.city?.message}>
                    <input {...form.register('school.city')} placeholder="e.g. Ikeja" />
                  </Field>
                  <Field label="State" error={form.formState.errors.school?.state?.message}>
                    <input {...form.register('school.state')} placeholder="e.g. Lagos" />
                  </Field>
                </div>
                
                <div className="grid gap-5 md:grid-cols-2">
                  <Field label="Contact Email (Optional)" error={form.formState.errors.school?.email?.message}>
                    <input type="email" {...form.register('school.email')} placeholder="admin@excellence.edu" />
                  </Field>
                  <Field label="Phone (Optional)" error={form.formState.errors.school?.phone?.message}>
                    <input {...form.register('school.phone')} placeholder="+234..." />
                  </Field>
                </div>

                <div className="pt-4 border-t border-[hsl(var(--border))]">
                  <Button type="submit" className="w-full h-12 text-base" disabled={onboard.isPending}>
                    {onboard.isPending ? 'Registering School...' : 'Register School'} <ChevronRight size={18} />
                  </Button>
                  <p className="text-center text-xs text-[hsl(var(--muted-foreground))] mt-4">
                    By registering, you agree to EduPulse Terms of Service and Privacy Policy.
                  </p>
                </div>
              </div>
            )}
          </form>
        </div>
      </div>
    </main>
  );
}