import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useForm } from '@tanstack/react-form';
import { signIn, authClient, useSession } from '../lib/auth-client';
import { LogIn, UserPlus, AlertCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import {
  Field,
  FieldGroup,
  FieldLabel,
  FieldError,
} from '@/components/ui/field';
import { Spinner } from '@/components/ui/spinner';

export function Login() {
  const [isSignUp, setIsSignUp] = useState(false);
  const [isFirstUser, setIsFirstUser] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();
  const { data: session } = useSession();

  useEffect(() => {
    async function checkStatus() {
      try {
        const response = await fetch(`${import.meta.env.VITE_API_URL || ''}/api/auth/registration-status`);
        const data = await response.json();
        setIsFirstUser(data.isFirstUser);
      } catch (err) {
        setIsFirstUser(false);
      }
    }
    checkStatus();
  }, []);

  const form = useForm({
    defaultValues: {
      name: '',
      email: '',
      password: '',
    },
    onSubmit: async ({ value }) => {
      setError(null);
      try {
        if (isSignUp) {
          const { error: signUpError } = await authClient.signUp.email({
            email: value.email,
            password: value.password,
            name: value.name,
            callbackURL: '/',
          });
          if (signUpError) {
            setError(signUpError.message || 'Failed to sign up');
          } else {
            navigate('/');
          }
        } else {
          const { error: signInError } = await signIn.email({
            email: value.email,
            password: value.password,
            callbackURL: '/',
          });

          if (signInError) {
            setError(signInError.message || 'Failed to sign in');
          } else {
            navigate('/');
          }
        }
      } catch (err) {
        setError('An unexpected error occurred');
      }
    },
  });

  // Redirect if already logged in
  if (session) {
    navigate('/');
    return null;
  }

  return (
    <Card className="w-full max-w-md shadow-xl">
      <CardHeader className="flex flex-col items-center text-center">
        <div className="w-12 h-12 bg-primary/10 rounded-full flex items-center justify-center text-primary mb-4">
          {isSignUp ? <UserPlus size={24} /> : <LogIn size={24} />}
        </div>
        <CardTitle className="text-2xl font-bold">
          {isSignUp ? (isFirstUser ? 'Create Admin Account' : 'Create Account') : 'Sign In'}
        </CardTitle>
        <CardDescription>
          {isSignUp 
            ? (isFirstUser ? 'Setup the first administrator account' : 'Join to start hosting your images') 
            : 'Sign in to manage your image gallery'}
        </CardDescription>
      </CardHeader>
      <CardContent>
        {error && (
          <Alert variant="destructive" className="mb-6">
            <AlertCircle className="size-4" />
            <AlertTitle>Error</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        <form
          onSubmit={(e) => {
            e.preventDefault();
            e.stopPropagation();
            form.handleSubmit();
          }}
        >
          <FieldGroup>
            {isSignUp && (
              <form.Field
                name="name"
                validators={{
                  onChange: ({ value }) =>
                    isSignUp && !value ? 'Name is required' : undefined,
                }}
                children={(field) => (
                  <Field
                    data-invalid={
                      field.state.meta.isTouched &&
                      field.state.meta.errors.length > 0
                    }
                  >
                    <FieldLabel htmlFor={field.name}>Full Name</FieldLabel>
                    <Input
                      id={field.name}
                      name={field.name}
                      type="text"
                      value={field.state.value}
                      onBlur={field.handleBlur}
                      onChange={(e) => field.handleChange(e.target.value)}
                      placeholder="Admin User"
                      aria-invalid={
                        field.state.meta.isTouched &&
                        field.state.meta.errors.length > 0
                      }
                    />
                    {field.state.meta.isTouched && (
                      <FieldError
                        errors={field.state.meta.errors.map((e) => ({
                          message: e?.toString(),
                        }))}
                      />
                    )}
                  </Field>
                )}
              />
            )}

            <form.Field
              name="email"
              validators={{
                onChange: ({ value }) =>
                  !value
                    ? 'Email is required'
                    : !/^\S+@\S+$/.test(value)
                      ? 'Invalid email address'
                      : undefined,
              }}
              children={(field) => (
                <Field
                  data-invalid={
                    field.state.meta.isTouched &&
                    field.state.meta.errors.length > 0
                  }
                >
                  <FieldLabel htmlFor={field.name}>Email Address</FieldLabel>
                  <Input
                    id={field.name}
                    name={field.name}
                    type="email"
                    value={field.state.value}
                    onBlur={field.handleBlur}
                    onChange={(e) => field.handleChange(e.target.value)}
                    placeholder="admin@example.com"
                    aria-invalid={
                      field.state.meta.isTouched &&
                      field.state.meta.errors.length > 0
                    }
                  />
                  {field.state.meta.isTouched && (
                    <FieldError
                      errors={field.state.meta.errors.map((e) => ({
                        message: e?.toString(),
                      }))}
                    />
                  )}
                </Field>
              )}
            />

            <form.Field
              name="password"
              validators={{
                onChange: ({ value }) =>
                  !value ? 'Password is required' : undefined,
              }}
              children={(field) => (
                <Field
                  data-invalid={
                    field.state.meta.isTouched &&
                    field.state.meta.errors.length > 0
                  }
                >
                  <FieldLabel htmlFor={field.name}>Password</FieldLabel>
                  <Input
                    id={field.name}
                    name={field.name}
                    type="password"
                    value={field.state.value}
                    onBlur={field.handleBlur}
                    onChange={(e) => field.handleChange(e.target.value)}
                    placeholder="••••••••"
                    aria-invalid={
                      field.state.meta.isTouched &&
                      field.state.meta.errors.length > 0
                    }
                  />
                  {field.state.meta.isTouched && (
                    <FieldError
                      errors={field.state.meta.errors.map((e) => ({
                        message: e?.toString(),
                      }))}
                    />
                  )}
                </Field>
              )}
            />

            <form.Subscribe
              selector={(state) => [state.canSubmit, state.isSubmitting]}
              children={([canSubmit, isSubmitting]) => (
                <Button
                  type="submit"
                  className="w-full mt-2"
                  disabled={!canSubmit || isSubmitting}
                >
                  {isSubmitting ? (
                    <>
                      <Spinner data-icon="inline-start" />
                      {isSignUp ? 'Signing Up...' : 'Signing In...'}
                    </>
                  ) : (
                    isSignUp ? 'Sign Up' : 'Sign In'
                  )}
                </Button>
              )}
            />
          </FieldGroup>
        </form>

        <div className="mt-6 text-center">
          <Button
            variant="link"
            size="sm"
            onClick={() => setIsSignUp(!isSignUp)}
            className="text-primary font-medium"
          >
            {isSignUp ? 'Already have an account? Sign In' : 'Need an account? Sign Up'}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
