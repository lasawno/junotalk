import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Search, UserPlus, Check, Phone } from "lucide-react";
import BackTriangle from "@/components/BackTriangle";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useI18n } from "@/lib/i18n.jsx";
import type { User } from "@shared/models/auth";

export default function AddContact() {
  const [, setLocation] = useLocation();
  const [searchQuery, setSearchQuery] = useState("");
  const { toast } = useToast();
  const { t } = useI18n();

  const { data: searchResults = [], isLoading } = useQuery<User[]>({
    queryKey: ["/api/users/search", searchQuery],
    enabled: searchQuery.length >= 2,
  });

  const addContactMutation = useMutation({
    mutationFn: async (contactId: string) => {
      return apiRequest("POST", "/api/contacts", { contactId });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/contacts"] });
      toast({
        title: t("common.success"),
        description: t("home.roomCreated"),
      });
    },
    onError: () => {
      toast({
        title: t("common.error"),
        description: t("home.createRoomError"),
        variant: "default",
      });
    },
  });

  const getInitials = (firstName?: string | null, lastName?: string | null) => {
    const first = firstName?.charAt(0) || "";
    const last = lastName?.charAt(0) || "";
    return (first + last).toUpperCase() || "?";
  };

  const getDisplayName = (firstName?: string | null, lastName?: string | null) => {
    const first = firstName || "";
    const lastInitial = lastName?.charAt(0) ? ` ${lastName.charAt(0)}.` : "";
    return `${first}${lastInitial}`.trim() || "Unknown";
  };

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="sticky top-0 z-50 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <div className="max-w-2xl mx-auto px-4">
          <div className="flex items-center gap-3 h-16">
            <BackTriangle onClick={() => setLocation("/")} testId="button-back" label={t("home.shareRoom")} />
          </div>
        </div>
      </header>

      <main className="max-w-2xl mx-auto px-4 py-6">
        {/* Search Input */}
        <div className="relative mb-6">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            type="search"
            placeholder={t("common.search")}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-10"
            data-testid="input-search-users"
          />
          <p className="text-xs text-muted-foreground mt-2 flex items-center gap-1">
            <Phone className="w-3 h-3" />
            {t("common.search")}
          </p>
        </div>

        {/* Search Results */}
        <div className="space-y-3">
          {searchQuery.length < 2 ? (
            <Card className="p-8 text-center border border-blue-500/15 scroll-brighten" style={{ borderColor: "rgba(96, 165, 250, 0.15)", background: "linear-gradient(135deg, #1a3a6e 0%, #243a72 50%, #1a3a6e 100%)" }}>
              <div className="w-16 h-16 rounded-full bg-blue-500/15 mx-auto mb-4 flex items-center justify-center">
                <Search className="w-8 h-8 text-blue-400" />
              </div>
              <h3 className="font-semibold text-white mb-2">{t("common.search")}</h3>
              <p className="text-blue-100/90 text-sm">
                {t("home.noActiveRoomsDesc")}
              </p>
            </Card>
          ) : isLoading ? (
            <div className="space-y-3">
              {[1, 2, 3].map((i) => (
                <Card key={i} className="p-4 animate-pulse border border-blue-500/15 scroll-brighten" style={{ borderColor: "rgba(96, 165, 250, 0.15)", background: "linear-gradient(135deg, #1a3a6e 0%, #243a72 50%, #1a3a6e 100%)" }}>
                  <div className="flex items-center gap-4">
                    <div className="w-12 h-12 rounded-full bg-blue-400/20" />
                    <div className="flex-1 space-y-2">
                      <div className="h-4 bg-blue-400/20 rounded w-32" />
                      <div className="h-3 bg-blue-400/20 rounded w-48" />
                    </div>
                  </div>
                </Card>
              ))}
            </div>
          ) : searchResults.length === 0 ? (
            <Card className="p-8 text-center border border-blue-500/15 scroll-brighten" style={{ borderColor: "rgba(96, 165, 250, 0.15)", background: "linear-gradient(150deg, #1a3a6e 0%, #243a72 50%, #1a3a6e 100%)" }}>
              <div className="w-16 h-16 rounded-full bg-blue-500/15 mx-auto mb-4 flex items-center justify-center">
                <UserPlus className="w-8 h-8 text-blue-400" />
              </div>
              <h3 className="font-semibold text-white mb-2">{t("common.noResults")}</h3>
              <p className="text-blue-100/90 text-sm">
                {t("error.tryAgain")}
              </p>
            </Card>
          ) : (
            searchResults.map((user) => (
              <Card 
                key={user.id} 
                className="p-4 hover-elevate border border-blue-500/15"
                data-testid={`card-user-${user.id}`}
                style={{ borderColor: "rgba(96, 165, 250, 0.15)", background: "linear-gradient(120deg, #1a3a6e 0%, #243a72 50%, #1a3a6e 100%)" }}
              >
                <div className="flex items-center gap-4">
                  <Avatar className="w-12 h-12">
                    <AvatarImage src={user.profileImageUrl || undefined} />
                    <AvatarFallback className="bg-primary/10 text-primary">
                      {getInitials(user.firstName, user.lastName)}
                    </AvatarFallback>
                  </Avatar>
                  <div className="flex-1 min-w-0">
                    <h3 className="font-medium truncate" data-testid={`text-name-${user.id}`}>
                      {getDisplayName(user.firstName, user.lastName)}
                    </h3>
                  </div>
                  <Button
                    size="sm"
                    onClick={() => addContactMutation.mutate(user.id)}
                    disabled={addContactMutation.isPending}
                    data-testid={`button-add-${user.id}`}
                  >
                    {addContactMutation.isPending ? (
                      <Check className="w-4 h-4" />
                    ) : (
                      <>
                        <UserPlus className="w-4 h-4 mr-2" />
                        {t("common.confirm")}
                      </>
                    )}
                  </Button>
                </div>
              </Card>
            ))
          )}
        </div>
      </main>
    </div>
  );
}
