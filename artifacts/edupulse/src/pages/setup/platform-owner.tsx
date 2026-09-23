import { useState } from 'react';
import { useLocation } from 'wouter';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { Zap, ShieldCheck, CheckCircle2, Lock, ArrowRight, Loader2, AlertCircle } from 'lucide-react';
import { useGetPlatformOwnerBootstrapStatus, useCreateInitialPlatformOwner } from '@workspace/api-client-react';
import { Button } from '@/components/shared';

const setupSchema = z.object({
  fullName: z.string().min(2, 'Full name must be at least 2 characters'),
  email: z.string().email('Please enter a valid email address'),
  phone: z.string().min(8, 'Phone number must be at least 8 characters').max(25, 'Phone number is too long'),
  setupKey: z.string().min(16, 'Setup key must be at least 16 characters'),
  password: z.string()
    .min(15, 'Password must be at least 15 characters')
    .regex(/[A-Z]/, 'Must contain at least one uppercase letter')
    .regex(/[0-9]/, 'Must contain at least one number')
    .regex(/[^A-Za-z0-9]/, 'Must contain at least one special character'),
  confirmPassword: z.string()
}).refine((data) => data.password === data.confirmPassword, {
  message: "Passwords don't match",
  path: ["confirmPassword"],
});

type SetupFormValues = z.infer<typeof setupSchema>;

export function PlatformOwnerSetup() {
  const [, setLocation] = useLocation();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const statusQuery = useGetPlatformOwnerBootstrapStatus();
  const createOwner = useCreateInitialPlatformOwner();

  const form = useForm<SetupFormValues>({
    resolver: zodResolver(setupSchema),
    defaultValues: {
      fullName: '',
      email: '',
      phone: '',
      setupKey: '',
      password: '',
      confirmPassword: '',
    },
  });

  const onSubmit = async (data: SetupFormValues) => {
    setIsSubmitting(true);
    setErrorMsg(null);
    try {
      const response = await createOwner.mutateAsync({
        data: {
          fullName: data.fullName,
          email: data.email,
          phone: data.phone,
          setupKey: data.setupKey,
          password: data.password,
        }
      });
      
      if (response.created) {
        setLocation(response.signInPath || '/sign-in');
      }
    } catch (err: any) {
      setErrorMsg(err?.message || 'Failed to initialize platform owner. Please verify your setup key.');
    } finally {
      setIsSubmitting(false);
    }
  };

  if (statusQuery.isLoading) {
    return (
      <div className="min-h-[100dvh] flex items-center justify-center bg-[hsl(var(--background))]">
        <Loader2 className="animate-spin text-[hsl(var(--primary))]" size={32} />
      </div>
    );
  }

  if (statusQuery.isError) {
    return (
      <div className="min-h-[100dvh] flex items-center justify-center bg-[hsl(var(--background))] p-4 text-center">
        <div className="max-w-md w-full space-y-4">
          <div className="mx-auto w-16 h-16 bg-[hsl(var(--destructive)/.12)] text-[hsl(var(--destructive))] rounded-2xl flex items-center justify-center mb-6">
            <AlertCircle size={32} />
          </div>
          <h1 className="text-2xl font-bold display-font">Connection Error</h1>
          <p className="text-[hsl(var(--muted-foreground))] text-sm leading-relaxed">
            Unable to verify setup status with the server. Please check your connection and try again.
          </p>
          <Button onClick={() => statusQuery.refetch()} variant="outline" className="mt-4 w-full">
            Retry Connection
          </Button>
        </div>
      </div>
    );
  }

  const status = statusQuery.data;

  if (status?.available === false) {
    return (
      <div className="min-h-[100dvh] flex items-center justify-center bg-[hsl(var(--background))] p-4 text-center">
        <div className="max-w-md w-full space-y-4">
          <div className="mx-auto w-16 h-16 bg-[hsl(157_37%_43%/.15)] text-[hsl(157_37%_30%)] dark:text-[hsl(157_37%_55%)] rounded-2xl flex items-center justify-center mb-6">
            <CheckCircle2 size={32} />
          </div>
          <h1 className="text-2xl font-bold display-font">Setup Complete</h1>
          <p className="text-[hsl(var(--muted-foreground))] text-sm leading-relaxed">
            The platform owner has already been configured. The setup plane is now permanently locked.
          </p>
          <Button onClick={() => setLocation('/sign-in')} className="mt-4 w-full">
            Go to Sign In <ArrowRight size={16} className="ml-1" />
          </Button>
        </div>
      </div>
    );
  }

  if (!status?.configured) {
    return (
      <div className="min-h-[100dvh] flex items-center justify-center bg-[hsl(var(--background))] p-4 text-center">
        <div className="max-w-md w-full space-y-4">
          <div className="mx-auto w-16 h-16 bg-[hsl(var(--muted))] text-[hsl(var(--muted-foreground))] rounded-2xl flex items-center justify-center mb-6">
            <Lock size={32} />
          </div>
          <h1 className="text-2xl font-bold display-font">Setup Unavailable</h1>
          <p className="text-[hsl(var(--muted-foreground))] text-sm leading-relaxed">
            Platform setup is currently locked or unavailable. Please ensure the server is properly configured to accept initial bootstrap connections.
          </p>
        </div>
      </div>
    );
  }

  const passwordVal = form.watch('password');
  const hasMinLength = passwordVal.length >= 15;
  const hasUpper = /[A-Z]/.test(passwordVal);
  const hasNumber = /[0-9]/.test(passwordVal);
  const hasSpecial = /[^A-Za-z0-9]/.test(passwordVal);

  return (
    <main className="min-h-[100dvh] bg-[hsl(var(--background))] flex items-center justify-center p-4 md:p-8">
      <div className="max-w-4xl w-full grid grid-cols-1 md:grid-cols-2 bg-[hsl(var(--card))] border border-[hsl(var(--border))] rounded-[28px] overflow-hidden shadow-2xl">
        
        {/* Left Side: Branding & Context */}
        <section className="relative hidden md:flex flex-col p-10 bg-[hsl(var(--sidebar))] text-[hsl(var(--sidebar-foreground))] overflow-hidden">
          <div className="absolute -left-24 -bottom-24 w-72 h-72 bg-[hsl(var(--primary)/.4)] rounded-full blur-[80px]" />
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_20%_30%,_hsl(var(--primary)/0.15)_0%,_transparent_40%),radial-gradient(circle_at_80%_80%,_hsl(var(--accent)/0.1)_0%,_transparent_40%)] pointer-events-none mix-blend-overlay" />
          
          <div className="relative z-10 flex items-center gap-3 mb-auto">
            <span className="grid h-11 w-11 place-items-center rounded-2xl bg-[hsl(var(--accent))] text-[hsl(var(--accent-foreground))] shadow-lg">
              <Zap size={21} />
            </span>
            <span className="display-font text-xl font-bold">Yemait EduCore</span>
          </div>
          
          <div className="relative z-10 mt-16 mb-12">
            <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-[hsl(var(--primary)/.2)] border border-[hsl(var(--primary)/.3)] text-[hsl(var(--primary-foreground))] text-xs font-bold mb-6">
              <ShieldCheck size={14} /> Control Plane Initialization
            </div>
            <h1 className="display-font text-4xl font-bold leading-tight mb-4">
              Initialize your platform.
            </h1>
            <p className="text-[hsl(var(--sidebar-foreground)/.7)] text-sm leading-relaxed max-w-sm">
              Securely configure the root platform owner account. This process can only be run once and requires your secure setup key provided during infrastructure deployment.
            </p>
          </div>
          
          <div className="relative z-10 mt-auto pt-8 border-t border-[hsl(var(--sidebar-border))]">
            <div className="flex items-center gap-3 text-xs text-[hsl(var(--sidebar-foreground)/.6)]">
              <Lock size={16} />
               <span>Your password is sent directly to the managed identity service and is never stored by Yemait EduCore.</span>
            </div>
          </div>
        </section>

        {/* Right Side: Form */}
        <section className="p-6 sm:p-10 flex flex-col justify-center">
          <div className="md:hidden flex items-center gap-2 mb-8">
            <span className="grid h-9 w-9 place-items-center rounded-xl bg-[hsl(var(--accent))] text-[hsl(var(--accent-foreground))]">
              <Zap size={17} />
            </span>
            <span className="display-font text-lg font-bold">Yemait EduCore</span>
          </div>

          <div className="mb-8">
            <h2 className="text-2xl font-bold display-font text-[hsl(var(--foreground))]">Owner Setup</h2>
            <p className="text-sm text-[hsl(var(--muted-foreground))] mt-1.5">Enter your details and setup key to unlock the platform.</p>
          </div>

          {errorMsg && (
            <div className="mb-6 p-4 rounded-xl bg-[hsl(var(--destructive)/.1)] text-[hsl(var(--destructive))] text-sm font-medium border border-[hsl(var(--destructive)/.2)] flex items-start gap-3">
              <AlertCircle size={18} className="shrink-0 mt-0.5" />
              <span>{errorMsg}</span>
            </div>
          )}

          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-5">
            <div className="space-y-1.5">
              <label className="text-xs font-bold text-[hsl(var(--muted-foreground))] uppercase tracking-wider">Setup Key</label>
              <input 
                 type="password" 
                {...form.register('setupKey')}
                 placeholder="Enter the deployment setup key"
                className="w-full border border-[hsl(var(--input))] rounded-xl bg-[hsl(var(--background))] px-4 py-3 text-sm focus:border-[hsl(var(--primary))] focus:ring-2 focus:ring-[hsl(var(--primary)/.2)] transition-all outline-none font-mono"
                autoComplete="off"
              />
              {form.formState.errors.setupKey && (
                <p className="text-xs font-medium text-[hsl(var(--destructive))] mt-1">{form.formState.errors.setupKey.message}</p>
              )}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
              <div className="space-y-1.5">
                <label className="text-xs font-bold text-[hsl(var(--muted-foreground))] uppercase tracking-wider">Full Name</label>
                <input 
                  type="text" 
                  {...form.register('fullName')}
                  placeholder="Jane Doe"
                  className="w-full border border-[hsl(var(--input))] rounded-xl bg-[hsl(var(--background))] px-4 py-3 text-sm focus:border-[hsl(var(--primary))] focus:ring-2 focus:ring-[hsl(var(--primary)/.2)] transition-all outline-none"
                />
                {form.formState.errors.fullName && (
                  <p className="text-xs font-medium text-[hsl(var(--destructive))] mt-1">{form.formState.errors.fullName.message}</p>
                )}
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-bold text-[hsl(var(--muted-foreground))] uppercase tracking-wider">Phone</label>
                <input 
                  type="tel" 
                  {...form.register('phone')}
                  placeholder="+1 234 567 8900"
                  className="w-full border border-[hsl(var(--input))] rounded-xl bg-[hsl(var(--background))] px-4 py-3 text-sm focus:border-[hsl(var(--primary))] focus:ring-2 focus:ring-[hsl(var(--primary)/.2)] transition-all outline-none"
                />
                {form.formState.errors.phone && (
                  <p className="text-xs font-medium text-[hsl(var(--destructive))] mt-1">{form.formState.errors.phone.message}</p>
                )}
              </div>
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-bold text-[hsl(var(--muted-foreground))] uppercase tracking-wider">Email Address</label>
              <input 
                type="email" 
                {...form.register('email')}
                placeholder="jane@school.edu"
                className="w-full border border-[hsl(var(--input))] rounded-xl bg-[hsl(var(--background))] px-4 py-3 text-sm focus:border-[hsl(var(--primary))] focus:ring-2 focus:ring-[hsl(var(--primary)/.2)] transition-all outline-none"
                autoComplete="off"
              />
              {form.formState.errors.email && (
                <p className="text-xs font-medium text-[hsl(var(--destructive))] mt-1">{form.formState.errors.email.message}</p>
              )}
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-bold text-[hsl(var(--muted-foreground))] uppercase tracking-wider">Password</label>
              <input 
                type="password" 
                {...form.register('password')}
                placeholder="••••••••••••"
                className="w-full border border-[hsl(var(--input))] rounded-xl bg-[hsl(var(--background))] px-4 py-3 text-sm focus:border-[hsl(var(--primary))] focus:ring-2 focus:ring-[hsl(var(--primary)/.2)] transition-all outline-none"
                autoComplete="new-password"
              />
              <div className="grid grid-cols-2 gap-y-1 mt-2 mb-1 px-1">
                <div className={`text-[10px] flex items-center gap-1.5 ${hasMinLength ? 'text-[hsl(157_37%_43%)]' : 'text-[hsl(var(--muted-foreground))]'}`}>
                  <div className={`w-1.5 h-1.5 rounded-full ${hasMinLength ? 'bg-current' : 'border border-current'}`} /> 15+ characters
                </div>
                <div className={`text-[10px] flex items-center gap-1.5 ${hasUpper ? 'text-[hsl(157_37%_43%)]' : 'text-[hsl(var(--muted-foreground))]'}`}>
                  <div className={`w-1.5 h-1.5 rounded-full ${hasUpper ? 'bg-current' : 'border border-current'}`} /> Uppercase
                </div>
                <div className={`text-[10px] flex items-center gap-1.5 ${hasNumber ? 'text-[hsl(157_37%_43%)]' : 'text-[hsl(var(--muted-foreground))]'}`}>
                  <div className={`w-1.5 h-1.5 rounded-full ${hasNumber ? 'bg-current' : 'border border-current'}`} /> Number
                </div>
                <div className={`text-[10px] flex items-center gap-1.5 ${hasSpecial ? 'text-[hsl(157_37%_43%)]' : 'text-[hsl(var(--muted-foreground))]'}`}>
                  <div className={`w-1.5 h-1.5 rounded-full ${hasSpecial ? 'bg-current' : 'border border-current'}`} /> Special character
                </div>
              </div>
              {form.formState.errors.password && (
                <p className="text-xs font-medium text-[hsl(var(--destructive))] mt-1">{form.formState.errors.password.message}</p>
              )}
            </div>

            <div className="space-y-1.5 pb-2">
              <label className="text-xs font-bold text-[hsl(var(--muted-foreground))] uppercase tracking-wider">Confirm Password</label>
              <input 
                type="password" 
                {...form.register('confirmPassword')}
                placeholder="••••••••••••"
                className="w-full border border-[hsl(var(--input))] rounded-xl bg-[hsl(var(--background))] px-4 py-3 text-sm focus:border-[hsl(var(--primary))] focus:ring-2 focus:ring-[hsl(var(--primary)/.2)] transition-all outline-none"
                autoComplete="new-password"
              />
              {form.formState.errors.confirmPassword && (
                <p className="text-xs font-medium text-[hsl(var(--destructive))] mt-1">{form.formState.errors.confirmPassword.message}</p>
              )}
            </div>

            <Button type="submit" disabled={isSubmitting} className="w-full h-12 text-sm">
              {isSubmitting ? <Loader2 size={18} className="animate-spin" /> : 'Initialize Platform'}
            </Button>
          </form>
        </section>
      </div>
    </main>
  );
}
