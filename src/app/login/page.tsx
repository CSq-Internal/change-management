"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { useStore } from "@/lib/store"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { useToast } from "@/components/ui/toaster"

export default function LoginPage() {
  const router = useRouter()
  const { login, loginWithGoogle } = useStore()
  const { toast } = useToast()
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")

  const submit = () => {
    if (!email || !password) {
      toast({ title: "Missing credentials", description: "Enter email and password.", variant: "error" })
      return
    }
    const ok = login(email, password)
    if (!ok) {
      toast({ title: "Login failed", description: "Invalid email or password.", variant: "error" })
      return
    }
    router.push("/")
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-[#f6f3ef] px-4">
      <Card className="w-full max-w-md border-slate-200/80 bg-white/95">
        <CardHeader className="space-y-2 text-center">
          <CardTitle className="text-2xl">Sign In</CardTitle>
          <CardDescription>Use your work credentials or Google SSO.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Button
            variant="outline"
            className="w-full"
            onClick={() => {
              loginWithGoogle()
              router.push("/")
            }}
          >
            Continue with Google
          </Button>
          <div className="text-center text-xs uppercase tracking-[0.2em] text-slate-400">or</div>
          <div className="space-y-3">
            <Input placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} />
            <Input
              type="password"
              placeholder="Password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
            <Button className="w-full" onClick={submit}>
              Sign in
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
