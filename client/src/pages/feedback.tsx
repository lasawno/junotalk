import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useAuth } from "@/hooks/use-auth";
import { useSEO, SEO_CONFIGS } from "@/hooks/use-seo";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Send,
  MessageSquare,
  ChevronDown,
} from "lucide-react";
import { Link, useLocation } from "wouter";
import BackTriangle from "@/components/BackTriangle";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import type { Feedback as FeedbackType } from "@shared/schema";
import MobileBottomNav from "@/components/MobileBottomNav";
import { useI18n } from "@/lib/i18n.jsx";

export default function Feedback() {
  useSEO(SEO_CONFIGS.feedback);
  const [, setLocation] = useLocation();
  const { user } = useAuth();
  const { toast } = useToast();
  const { t } = useI18n();

  const [feedbackName, setFeedbackName] = useState("");
  const [feedbackComment, setFeedbackComment] = useState("");
  const [formOpen, setFormOpen] = useState(false);

  const { data: feedbackList = [], isLoading: loadingFeedback } = useQuery<FeedbackType[]>({
    queryKey: ["/api/feedback"],
    enabled: !!user,
  });

  const submitFeedbackMutation = useMutation({
    mutationFn: async () => {
      return apiRequest("POST", "/api/feedback", {
        firstName: feedbackName,
        comment: feedbackComment,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/feedback"] });
      setFeedbackName("");
      setFeedbackComment("");
      toast({
        title: t("feedback.submitted"),
        description: t("feedback.submitted"),
      });
    },
    onError: () => {
      toast({ title: t("common.error"), description: t("feedback.submitError"), variant: "default" });
    },
  });

  if (!user) return null;

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <header className="sticky top-0 z-50 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <div className="max-w-2xl mx-auto px-4 flex items-center h-14 gap-0">
          <BackTriangle onClick={() => setLocation("/")} testId="button-back-home" label={t("feedback.title")} />
        </div>
      </header>

      <main className="flex-1 max-w-2xl mx-auto w-full px-4 py-4 pb-20">
        <Card className="mb-6">
          <CardContent className="pt-4">
            <button
              onClick={() => setFormOpen(!formOpen)}
              className="flex items-center justify-between w-full text-left"
              data-testid="button-toggle-feedback-form"
            >
              <h3 className="text-sm font-medium">{t("feedback.shareFeedback")}</h3>
              <ChevronDown className={`w-4 h-4 text-muted-foreground transition-transform duration-200 ${formOpen ? "rotate-180" : ""}`} />
            </button>
            {formOpen && (
              <div className="space-y-4 mt-4">
                <Input
                  type="text"
                  placeholder={t("feedback.namePlaceholder")}
                  value={feedbackName}
                  onChange={(e) => setFeedbackName(e.target.value)}
                  data-testid="input-feedback-name"
                />
                <Textarea
                  placeholder={t("feedback.commentPlaceholder")}
                  value={feedbackComment}
                  onChange={(e) => setFeedbackComment(e.target.value)}
                  className="min-h-[120px]"
                  data-testid="input-feedback-comment"
                />
                <Button
                  onClick={(e) => { e.preventDefault(); submitFeedbackMutation.mutate(); }}
                  disabled={!feedbackName.trim() || !feedbackComment.trim() || submitFeedbackMutation.isPending}
                  type="button"
                  data-testid="button-submit-feedback"
                >
                  <Send className="w-4 h-4 mr-2" />
                  {submitFeedbackMutation.isPending ? t("feedback.submitting") : t("feedback.submit")}
                </Button>
              </div>
            )}
          </CardContent>
        </Card>

        <h3 className="text-sm font-medium mb-3">{t("feedback.communityWall")}</h3>
        {loadingFeedback ? (
          <div className="space-y-3">
            {[1, 2, 3].map((i) => (
              <div key={i} className="p-4 rounded-lg bg-muted/30 animate-pulse">
                <div className="h-4 w-24 bg-muted rounded mb-2" />
                <div className="h-3 w-full bg-muted rounded" />
              </div>
            ))}
          </div>
        ) : feedbackList.length === 0 ? (
          <div className="text-center py-12 text-muted-foreground">
            <MessageSquare className="w-10 h-10 mx-auto mb-3 opacity-50" />
            <p className="font-medium">{t("feedback.noFeedback")}</p>
            <p className="text-sm mt-1">{t("feedback.shareFeedback")}</p>
          </div>
        ) : (
          <div className="space-y-3">
            {feedbackList.map((item) => (
              <Card
                key={item.id}
                data-testid={`feedback-${item.id}`}
              >
                <CardContent className="p-4">
                  <div className="flex items-center justify-between mb-2">
                    <span className="font-medium text-primary">{item.firstName}</span>
                    <span className="text-xs text-muted-foreground">
                      {new Date(item.createdAt!).toLocaleDateString()}
                    </span>
                  </div>
                  <p className="text-sm text-foreground">{item.comment}</p>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </main>
      <div className="pb-20 sm:pb-3" />
      <MobileBottomNav />
    </div>
  );
}
