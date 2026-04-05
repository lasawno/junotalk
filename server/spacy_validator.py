import json
import sys
import spacy

nlp_es = spacy.load("es_core_news_sm")
nlp_en = spacy.load("en_core_web_sm")

ENGLISH_ENDEARMENTS = {"babe", "baby", "bae", "honey", "hon", "love", "dear", "darling", "sweetheart", "sweetie", "cutie", "beautiful", "handsome", "gorgeous"}
ENGLISH_MISS_PATTERNS = {"miss", "missing"}
ENGLISH_AFFECTION_VERBS = {"love", "adore", "need", "want", "miss", "kiss", "hug", "embrace"}

PRONOUN_VERBS = {
    "extrañar": "te", "extraño": "te", "extraña": "te", "extrañas": "me",
    "echo": "te", "echas": "me",
    "querer": "te", "quiero": "te", "quieres": "me",
    "amar": "te", "amo": "te", "amas": "me",
    "necesitar": "te", "necesito": "te", "necesitas": "me",
    "adoro": "te", "adoras": "me",
    "abrazo": "te", "abrazas": "me",
    "beso": "te", "besas": "me",
}

ENDEARMENT_CORRECTIONS = {
    "nena": "cariño",
    "nene": "cariño",
    "chica": "cariño",
    "chico": "cariño",
}

def analyze_english_input(text):
    doc = nlp_en(text)
    tokens = [t for t in doc]
    token_texts_lower = [t.text.lower() for t in tokens]

    has_endearment = any(t.lower() in ENGLISH_ENDEARMENTS for t in token_texts_lower)
    has_affection = any(t.lower() in ENGLISH_AFFECTION_VERBS for t in token_texts_lower)
    has_miss = any(t.lower() in ENGLISH_MISS_PATTERNS for t in token_texts_lower)
    has_question = text.strip().endswith("?") or any(t.text.lower() in {"what", "how", "where", "when", "why", "who", "which", "do", "does", "did", "are", "is", "can", "could", "would", "will"} and i == 0 for i, t in enumerate(tokens))
    has_exclamation = text.strip().endswith("!")

    is_first_person = any(t.text.lower() in ("i", "i'm", "i'll", "i've", "i'd", "my", "me", "mine") for t in tokens)
    is_second_person = any(t.text.lower() in ("you", "you're", "you'll", "you've", "your", "yours") for t in tokens)

    endearment_words = [t.text for t in tokens if t.text.lower() in ENGLISH_ENDEARMENTS]
    affection_words = [t.text for t in tokens if t.text.lower() in ENGLISH_AFFECTION_VERBS]

    implied_you = has_affection and not is_second_person and (is_first_person or len(tokens) <= 5)

    tone = "neutral"
    if has_endearment or has_affection:
        tone = "romantic"
    elif has_question:
        tone = "questioning"
    elif has_exclamation:
        tone = "emphatic"

    pos_tags = [(t.text, t.pos_, t.dep_) for t in tokens]

    hints = []
    if has_miss and has_endearment:
        hints.append("use_echo_de_menos_or_extraño_with_endearment")
    elif has_miss:
        hints.append("use_echo_de_menos_or_extraño")
    if implied_you:
        hints.append("add_te_pronoun_implied_you")
    if has_endearment:
        hints.append("use_natural_spanish_endearment:cariño/mi_amor/mi_vida/corazón")
    if has_question:
        hints.append("use_inverted_question_marks")
    if has_exclamation:
        hints.append("use_inverted_exclamation_marks")
    if is_first_person and has_affection and not is_second_person:
        hints.append("include_object_pronoun_te")

    return {
        "text": text,
        "tone": tone,
        "has_endearment": has_endearment,
        "has_affection": has_affection,
        "has_miss": has_miss,
        "has_question": has_question,
        "has_exclamation": has_exclamation,
        "implied_you": implied_you,
        "is_first_person": is_first_person,
        "is_second_person": is_second_person,
        "endearment_words": endearment_words,
        "affection_words": affection_words,
        "hints": hints,
        "tokens": len(tokens),
        "pos_tags": pos_tags[:20],
    }


def validate_spanish_output(text):
    doc = nlp_es(text)
    issues = []
    suggestions = []
    score = 100

    tokens = [t for t in doc]
    token_texts = [t.text.lower() for t in tokens]
    has_verb = any(t.pos_ == "VERB" for t in tokens)
    has_pronoun = any(t.pos_ in ("PRON", "AUX") and t.text.lower() in ("te", "me", "se", "le", "nos", "os", "les") for t in tokens)

    for t in tokens:
        low = t.text.lower()
        if low in PRONOUN_VERBS and not has_pronoun:
            expected = PRONOUN_VERBS[low]
            issues.append(f"missing_pronoun:{expected}+{low}")
            suggestions.append(f"Add '{expected}' before '{t.text}' — native speakers always include it")
            score -= 20

    for t in tokens:
        low = t.text.lower()
        if low in ENDEARMENT_CORRECTIONS:
            better = ENDEARMENT_CORRECTIONS[low]
            if low != better:
                issues.append(f"unnatural_endearment:{low}->{better}")
                suggestions.append(f"Replace '{t.text}' with '{better}' — more natural in conversational Spanish")
                score -= 10

    if has_verb:
        verb_tokens = [t for t in tokens if t.pos_ == "VERB"]
        for v in verb_tokens:
            low = v.text.lower()
            if low in ("echo",) and "de" not in token_texts:
                issues.append("incomplete_expression:echo_de_menos")
                suggestions.append("'echo' needs 'de menos' — 'te echo de menos'")
                score -= 15

    question_words = {"qué", "cómo", "dónde", "cuándo", "cuánto", "cuál", "quién", "por"}
    has_question = any(t.text.lower() in question_words for t in tokens) or text.strip().endswith("?")
    if has_question and not text.strip().startswith("¿"):
        issues.append("missing_inverted_question")
        suggestions.append("Add '¿' at the start — required in Spanish questions")
        score -= 5

    if text.strip().endswith("!") and not "¡" in text:
        issues.append("missing_inverted_exclamation")
        suggestions.append("Add '¡' at the start — required in Spanish exclamations")
        score -= 5

    pos_tags = [t.pos_ for t in tokens if t.pos_ != "PUNCT"]

    return {
        "text": text,
        "score": max(0, score),
        "natural": score >= 80,
        "issues": issues,
        "suggestions": suggestions,
        "tokens": len(tokens),
        "pos_summary": {pos: pos_tags.count(pos) for pos in set(pos_tags)},
    }


def oversight_check(source, translation, target_lang):
    input_analysis = analyze_english_input(source)
    issues = []
    score = 100

    src_tokens = len(source.split())
    trans_tokens = len(translation.split())
    if src_tokens > 0:
        ratio = trans_tokens / src_tokens
        if ratio > 3.0:
            issues.append("translation_too_long: output is much longer than input, may contain extra content")
            score -= 20
        elif ratio < 0.2 and src_tokens > 3:
            issues.append("translation_too_short: output lost significant content")
            score -= 25

    if source.strip().endswith("?") and not translation.strip().endswith("?"):
        if target_lang and target_lang.lower() in ("es", "spa", "spanish"):
            if not translation.strip().endswith("?"):
                issues.append("question_not_preserved: source is a question but translation is not")
                score -= 15
        else:
            issues.append("question_not_preserved: source is a question but translation is not")
            score -= 15

    if input_analysis.get("has_endearment"):
        issues.append("hint:source_has_endearment_terms — ensure translation includes equivalent affectionate terms")

    if input_analysis.get("has_affection"):
        issues.append("hint:source_has_affection — preserve emotional tone in translation")

    if input_analysis.get("has_miss"):
        issues.append("hint:source_expresses_missing_someone — ensure this sentiment is clearly conveyed")

    if input_analysis.get("implied_you"):
        issues.append("hint:source_implies_you — add the appropriate pronoun in translation")

    src_lower = source.lower()
    trans_lower = translation.lower()

    negation_words_en = {"not", "don't", "doesn't", "didn't", "won't", "can't", "never", "no", "nothing", "nowhere", "nobody"}
    src_has_negation = any(w in src_lower.split() for w in negation_words_en)
    if src_has_negation and len(translation) > 2:
        common_negations = {"no", "not", "nicht", "pas", "ne", "non", "nunca", "never", "nada", "jamás", "ni", "tampoco"}
        trans_has_negation = any(w in trans_lower.split() for w in common_negations)
        if not trans_has_negation:
            issues.append("negation_lost: source has negation but translation may not")
            score -= 20

    src_numbers = [w for w in source.split() if any(c.isdigit() for c in w)]
    for num in src_numbers:
        if num not in translation:
            issues.append(f"number_missing: '{num}' from source not found in translation")
            score -= 10

    return {
        "source": source,
        "translation": translation,
        "target_lang": target_lang,
        "input_analysis": input_analysis,
        "score": max(0, score),
        "passed": score >= 70,
        "issues": issues,
    }


def full_validate(data):
    mode = data.get("mode", "output")
    text = data.get("text", "")

    if mode == "input":
        return analyze_english_input(text)
    elif mode == "output":
        return validate_spanish_output(text)
    elif mode == "oversight":
        source = data.get("source", "")
        translation = data.get("translation", "")
        target_lang = data.get("target_lang", "")
        return oversight_check(source, translation, target_lang)
    elif mode == "both":
        source = data.get("source", "")
        translation = data.get("translation", "")
        input_analysis = analyze_english_input(source) if source else None
        output_validation = validate_spanish_output(translation) if translation else None

        if input_analysis and output_validation:
            if input_analysis.get("implied_you") and not output_validation.get("natural"):
                if not any("missing_pronoun" in i for i in output_validation.get("issues", [])):
                    output_validation["issues"].append("context:input_implies_te_pronoun")
                    output_validation["suggestions"].append("Source text implies 'you' — add 'te' pronoun")
                    output_validation["score"] = max(0, output_validation["score"] - 15)
                    output_validation["natural"] = output_validation["score"] >= 80

            if input_analysis.get("has_endearment") and output_validation.get("natural"):
                has_spanish_endearment = any(w in translation.lower() for w in ["cariño", "amor", "vida", "corazón", "bebé", "cielo", "hermosa", "hermoso", "guapa", "guapo", "querida", "querido"])
                if not has_spanish_endearment:
                    output_validation["issues"].append("missing_endearment_in_translation")
                    output_validation["suggestions"].append("Source has endearment term — add natural Spanish equivalent (cariño, mi amor, etc.)")
                    output_validation["score"] = max(0, output_validation["score"] - 15)
                    output_validation["natural"] = output_validation["score"] >= 80

            if input_analysis.get("has_question") and not translation.strip().startswith("¿"):
                if "missing_inverted_question" not in output_validation.get("issues", []):
                    output_validation["issues"].append("missing_inverted_question_from_input")
                    output_validation["suggestions"].append("Source is a question — Spanish requires ¿...?")
                    output_validation["score"] = max(0, output_validation["score"] - 5)
                    output_validation["natural"] = output_validation["score"] >= 80

            if input_analysis.get("has_exclamation") and "¡" not in translation:
                if "missing_inverted_exclamation" not in output_validation.get("issues", []):
                    output_validation["issues"].append("missing_inverted_exclamation_from_input")
                    output_validation["suggestions"].append("Source is emphatic — Spanish requires ¡...!")
                    output_validation["score"] = max(0, output_validation["score"] - 5)
                    output_validation["natural"] = output_validation["score"] >= 80

        return {
            "input_analysis": input_analysis,
            "output_validation": output_validation,
        }
    else:
        return validate_spanish_output(text)


def main():
    if len(sys.argv) < 2:
        data = json.loads(sys.stdin.read())
    else:
        data = {"text": " ".join(sys.argv[1:])}

    if isinstance(data, list):
        results = [full_validate(item) for item in data]
        print(json.dumps(results))
    else:
        result = full_validate(data)
        print(json.dumps(result))

if __name__ == "__main__":
    main()
