"use client";

import { useState, useRef, useTransition } from "react";
import Image from "next/image";
import { Icon } from "@/components/icons";
import { updateProfilePhoto, updatePassword } from "./actions";

interface ProfileFormProps {
  user: {
    id: string;
    fullName: string;
    email: string;
    photoUrl: string | null;
  };
  role: string;
}

export function ProfileForm({ user, role }: ProfileFormProps) {
  const [photoUrl, setPhotoUrl] = useState(user.photoUrl);
  const [isUploading, setIsUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  
  const [currentPass, setCurrentPass] = useState("");
  const [newPass, setNewPass] = useState("");
  const [confirmPass, setConfirmPass] = useState("");
  const [isPending, startTransition] = useTransition();
  const [message, setMessage] = useState<{ type: "success" | "error", text: string } | null>(null);

  const handlePhotoClick = () => {
    fileInputRef.current?.click();
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsUploading(true);
    const formData = new FormData();
    formData.append("file", file);

    try {
      const res = await fetch("/api/upload-photo", {
        method: "POST",
        body: formData,
      });
      const data = await res.json();
      if (data.success) {
        setPhotoUrl(data.url);
        await updateProfilePhoto(data.url);
        // We could show a toast here
      } else {
        alert(data.error || "Erreur lors de l'upload");
      }
    } catch {
      alert("Erreur de connexion");
    } finally {
      setIsUploading(false);
    }
  };

  const handlePasswordSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setMessage(null);

    if (newPass !== confirmPass) {
      setMessage({ type: "error", text: "Les nouveaux mots de passe ne correspondent pas." });
      return;
    }
    
    if (newPass.length < 6) {
      setMessage({ type: "error", text: "Le mot de passe doit contenir au moins 6 caractères." });
      return;
    }

    startTransition(async () => {
      try {
        await updatePassword(currentPass, newPass);
        setMessage({ type: "success", text: "Votre mot de passe a été modifié avec succès." });
        setCurrentPass("");
        setNewPass("");
        setConfirmPass("");
      } catch (err) {
        setMessage({ type: "error", text: err instanceof Error ? err.message : "Une erreur est survenue." });
      }
    });
  };

  return (
    <div className="grid gap-8 lg:grid-cols-2">
      {/* Informations Générales */}
      <section className="rounded-xl border border-border bg-white p-6 shadow-sm">
        <h2 className="text-lg font-semibold text-foreground mb-6">Informations générales</h2>
        
        <div className="flex items-center gap-6 mb-8">
          <div className="relative">
            <div 
              className="relative size-24 overflow-hidden rounded-full border-4 border-white shadow-sm bg-slate-100 group cursor-pointer"
              onClick={handlePhotoClick}
            >
              {photoUrl ? (
                <Image src={photoUrl} alt="Photo de profil" fill sizes="96px" className="object-cover" />
              ) : (
                <div className="grid size-full place-items-center bg-primary text-3xl font-semibold text-primary-foreground">
                  {user.fullName.charAt(0)}
                </div>
              )}
              
              <div className="absolute inset-0 bg-black/40 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                <Icon name="camera" className="size-6 text-white" />
              </div>
            </div>
            {isUploading && (
              <div className="absolute inset-0 flex items-center justify-center bg-white/50 rounded-full">
                <Icon name="loader" className="size-6 animate-spin text-primary" />
              </div>
            )}
            <input 
              type="file" 
              ref={fileInputRef} 
              className="hidden" 
              accept="image/*"
              onChange={handleFileChange}
            />
          </div>
          
          <div>
            <h3 className="text-xl font-bold text-foreground">{user.fullName}</h3>
            <span className="inline-block mt-1 rounded-full bg-info-bg px-2.5 py-0.5 text-xs font-medium text-info">
              {role}
            </span>
          </div>
        </div>
        
        <div className="space-y-4">
          <div>
            <label className="text-sm font-medium text-muted-foreground">Email</label>
            <div className="mt-1 flex w-full items-center gap-2 rounded-lg border border-border bg-slate-50 px-3 py-2 text-sm text-foreground">
              <Icon name="mail" className="size-4 text-muted-foreground" />
              {user.email}
            </div>
          </div>
        </div>
      </section>

      {/* Sécurité */}
      <section className="rounded-xl border border-border bg-white p-6 shadow-sm">
        <h2 className="text-lg font-semibold text-foreground mb-6">Sécurité</h2>
        
        <form onSubmit={handlePasswordSubmit} className="space-y-4">
          {message && (
            <div className={`p-3 rounded-lg text-sm ${message.type === 'success' ? 'bg-success-bg text-success' : 'bg-danger-bg text-danger'}`}>
              {message.text}
            </div>
          )}
          
          <div>
            <label className="text-sm font-medium text-foreground">Ancien mot de passe</label>
            <input
              type="password"
              value={currentPass}
              onChange={e => setCurrentPass(e.target.value)}
              className="mt-1 block w-full rounded-lg border border-input bg-transparent px-3 py-2 text-sm text-foreground shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
              required
            />
          </div>
          
          <div className="pt-2">
            <label className="text-sm font-medium text-foreground">Nouveau mot de passe</label>
            <input
              type="password"
              value={newPass}
              onChange={e => setNewPass(e.target.value)}
              className="mt-1 block w-full rounded-lg border border-input bg-transparent px-3 py-2 text-sm text-foreground shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
              required
              minLength={8}
            />
          </div>
          
          <div>
            <label className="text-sm font-medium text-foreground">Confirmer le mot de passe</label>
            <input
              type="password"
              value={confirmPass}
              onChange={e => setConfirmPass(e.target.value)}
              className="mt-1 block w-full rounded-lg border border-input bg-transparent px-3 py-2 text-sm text-foreground shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
              required
              minLength={8}
            />
          </div>

          <div className="flex items-center justify-between pt-4">
            <a href="/forgot-password" className="text-sm text-primary hover:underline">
              Mot de passe oublié ?
            </a>
            <button
              type="submit"
              disabled={isPending}
              className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow-sm hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-50 disabled:pointer-events-none"
            >
              {isPending ? "Modification..." : "Mettre à jour"}
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}
