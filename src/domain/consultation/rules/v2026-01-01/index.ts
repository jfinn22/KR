import type { Rule, Ruleset } from '../../types'
import { DEFAULT_ENGINE_SETTINGS } from '../../types'
import {
  appliedToLengths,
  hasValidPatchTest,
  monthsSince,
  occurrencesOf,
  requestedLift,
  startingLevel,
  wantsDye,
  wantsExtensions,
  wantsLightening,
} from '../../facts'

/**
 * Ruleset v2026-01-01.
 *
 * A PUBLISHED VERSION DIRECTORY IS IMMUTABLE. To change behaviour, copy the
 * directory forward, bump the version string, edit there, and register it.
 * Historical consultations keep evaluating against the version that produced
 * the decision a stylist actually approved.
 *
 * Every rule returns a `recommendedPath`. That is not politeness — a flag that
 * only refuses is a flag stylists learn to click past.
 */

const boxDyeHighLift: Rule = {
  id: 'BOX_DYE_HIGH_LIFT',
  version: 1,
  category: 'CHEMICAL_HISTORY',
  appliesWhen: (c) => wantsLightening(c.facts) && c.facts.goal.targetLevel !== null,
  evaluate: ({ facts }) => {
    const boxDye = occurrencesOf(facts, 'BOX_DYE')
    if (boxDye.length === 0) return null
    if (!appliedToLengths(boxDye)) return null

    const lift = requestedLift(facts)
    if (lift < 3) return null

    const recent = monthsSince(facts, 'BOX_DYE')
    const severe = lift >= 5 || recent <= 6 || boxDye.length >= 3
    const sessions = lift >= 5 ? 3 : 2

    return {
      flag: {
        code: 'BOX_DYE_HIGH_LIFT',
        severity: severe ? 'HIGH' : 'CAUTION',
        title: 'Box dye on the lengths with a high-lift goal',
        detail:
          `Home colour was reported ${recent >= 240 ? 'at an unknown time' : `${recent} months ago`} ` +
          `on the mid-lengths and ends, with a ${lift}-level lift requested. Box dye deposits ` +
          `unevenly and builds up on the ends, so lift is unpredictable and banding is very likely ` +
          `in a single session.`,
        evidence: [
          { path: 'history[BOX_DYE].monthsAgo', value: recent, label: 'Most recent box dye' },
          { path: 'hair.currentLevel.mids', value: startingLevel(facts), label: 'Starting level' },
          { path: 'goal.targetLevel', value: facts.goal.targetLevel, label: 'Target level' },
        ],
        recommendedPath:
          `Plan ${sessions} lightening sessions 6–8 weeks apart with a bond builder, and run a ` +
          `strand test at the first appointment to confirm how the hair lifts before committing ` +
          `to a full head.`,
      },
      complexity: { delta: severe ? 22 : 14, reason: 'Box dye build-up with uneven lift risk' },
      duration: [
        {
          scope: 'TOTAL',
          op: 'ADD_MINUTES',
          value: severe ? 90 : 45,
          reason: 'Sectioned application and closer monitoring',
        },
        {
          scope: { phaseKind: 'PROCESSING' },
          op: 'MULTIPLY',
          value: 1.2,
          reason: 'Slower, staged lift',
        },
      ],
      requirements: [
        {
          kind: 'STRAND_TEST',
          dueBefore: 'SESSION',
          sessionSequence: 1,
          rationale: 'Confirm lift and integrity before a full-head application.',
        },
      ],
      sessionPlan: {
        minSessions: sessions,
        strategy: 'GRADUAL_LIFT',
        spacingDays: Array.from({ length: sessions - 1 }, () => ({ minDays: 42, maxDays: 84 })),
        sessionLabels:
          sessions === 3
            ? ['Lift & tone — session 1', 'Lift & tone — session 2', 'Refine & gloss']
            : ['Lift & tone — session 1', 'Refine & gloss'],
        rationale: 'Gradual lift protects the hair and evens out the box-dye band.',
      },
      depositBandFloor: severe ? 3 : 2,
    }
  },
  docs: {
    rationale:
      'Box dye on the lengths is the single most common cause of quoted-versus-actual blowouts ' +
      'and of mid-service integrity failures.',
    clientExplanation:
      'Home colour builds up on the ends and lifts unevenly. We get a far better, healthier ' +
      'result across two or three visits than by forcing it in one.',
  },
}

const hennaLightenerConflict: Rule = {
  id: 'HENNA_LIGHTENER_CONFLICT',
  version: 1,
  category: 'CHEMICAL_HISTORY',
  appliesWhen: (c) => wantsLightening(c.facts),
  evaluate: ({ facts }) => {
    const henna = occurrencesOf(facts, 'HENNA')
    if (henna.length === 0) return null

    const unknownProduct = henna.some((h) => !h.productKnown)

    return {
      flag: {
        code: 'HENNA_LIGHTENER_CONFLICT',
        severity: unknownProduct ? 'BLOCKER' : 'HIGH',
        title: unknownProduct
          ? 'Henna of unknown origin — lightening cannot be booked online'
          : 'Henna history with a lightening service',
        detail:
          'Compound henna can contain metallic salts. Combined with peroxide these react ' +
          'exothermically and can melt or smoke the hair in the bowl. Pure body-art henna is ' +
          'safer but still resists lift and dulls tone unpredictably.',
        evidence: [
          {
            path: 'history[HENNA].productKnown',
            value: !unknownProduct,
            label: 'Product identified',
          },
          {
            path: 'history[HENNA].monthsAgo',
            value: monthsSince(facts, 'HENNA'),
            label: 'Most recent henna',
          },
        ],
        recommendedPath:
          'Book a free 20-minute in-person consult. We take a small cutting and run an ' +
          'incompatibility test. If it is clear we plan a gradual lift; if not we look at ' +
          'colour-safe alternatives such as a gloss or low-lift toning.',
        blocksOnlineBooking: unknownProduct,
      },
      complexity: { delta: 30, reason: 'Henna incompatibility risk' },
      requirements: [
        {
          kind: 'IN_PERSON_CONSULT',
          dueBefore: 'BOOKING',
          rationale: 'A physical incompatibility test is required before any lightener is booked.',
        },
        {
          kind: 'STRAND_TEST',
          dueBefore: 'BOOKING',
          rationale: 'Metallic-salt incompatibility test on a cutting.',
        },
      ],
      forcesMode: 'IN_PERSON',
      depositBandFloor: 3,
    }
  },
  docs: {
    rationale:
      'A metallic-salt and peroxide reaction is the highest-severity physical safety event that ' +
      'can happen in a colour salon.',
    clientExplanation:
      'Henna and bleach can react badly together. A quick in-salon test tells us exactly what is ' +
      'safe for your hair.',
  },
}

const blackBoxToPlatinum: Rule = {
  id: 'BLACK_BOX_TO_PLATINUM',
  version: 1,
  category: 'GOAL_FEASIBILITY',
  appliesWhen: (c) => wantsLightening(c.facts) && (c.facts.goal.targetLevel ?? 0) >= 9,
  evaluate: ({ facts }) => {
    const dark = occurrencesOf(facts, 'BOX_DYE').some(
      (h) => h.appliedTo.length > 0 && (facts.hair.currentLevel.mids ?? 10) <= 4,
    )
    if (!dark) return null

    return {
      flag: {
        code: 'BLACK_BOX_TO_PLATINUM',
        severity: 'BLOCKER',
        title: 'Dark box colour to platinum is not a one-visit service',
        detail:
          'Lifting dark home colour to a level 9 or 10 removes a great deal of pigment and puts ' +
          'the hair under real stress. Attempting it in one visit is how hair breaks, and the ' +
          'result is usually warm and uneven rather than platinum.',
        evidence: [
          {
            path: 'hair.currentLevel.mids',
            value: facts.hair.currentLevel.mids,
            label: 'Current level',
          },
          { path: 'goal.targetLevel', value: facts.goal.targetLevel, label: 'Target level' },
        ],
        recommendedPath:
          'A three-session correction over roughly four months, with bond building throughout ' +
          'and a gloss between sessions so you look finished at every stage. We will confirm the ' +
          'plan in person and take a strand test first.',
        blocksOnlineBooking: true,
      },
      complexity: { delta: 35, reason: 'Full colour correction from dark box dye' },
      requirements: [
        {
          kind: 'IN_PERSON_CONSULT',
          dueBefore: 'BOOKING',
          rationale: 'Correction of this size must be assessed by hand.',
        },
        {
          kind: 'STRAND_TEST',
          dueBefore: 'SESSION',
          sessionSequence: 1,
          rationale: 'Confirm lift behaviour and integrity.',
        },
      ],
      sessionPlan: {
        minSessions: 3,
        strategy: 'COLOR_REMOVAL_FIRST',
        spacingDays: [
          { minDays: 42, maxDays: 84 },
          { minDays: 42, maxDays: 84 },
        ],
        sessionLabels: ['Colour removal & first lift', 'Second lift & tone', 'Refine to target'],
        rationale: 'Removing pigment gradually protects the hair and gets a cleaner blonde.',
      },
      forcesMode: 'IN_PERSON',
      depositBandFloor: 3,
    }
  },
  docs: {
    rationale:
      'The single most common unrealistic request in a colour salon, and the one most likely to ' +
      'end in breakage and a refund.',
    clientExplanation:
      'Going from dark box colour to platinum safely takes a few visits. We will get you there ' +
      'with your hair intact, and you will look good along the way.',
  },
}

const extensionsOnFragileHair: Rule = {
  id: 'EXTENSIONS_ON_FRAGILE_HAIR',
  version: 1,
  category: 'INTEGRITY',
  appliesWhen: (c) => wantsExtensions(c.facts),
  evaluate: ({ facts }) => {
    const reasons = []
    if (facts.hair.elasticity === 'POOR') {
      reasons.push({ path: 'hair.elasticity', value: 'POOR', label: 'Elasticity' })
    }
    if ((facts.hair.integrityScore ?? 10) <= 4) {
      reasons.push({
        path: 'hair.integrityScore',
        value: facts.hair.integrityScore,
        label: 'Integrity score',
      })
    }
    if (facts.hair.breakageReported) {
      reasons.push({ path: 'hair.breakageReported', value: true, label: 'Breakage reported' })
    }
    if (facts.hair.texture === 'FINE' && facts.hair.density === 'LOW') {
      reasons.push({ path: 'hair.texture+density', value: 'FINE/LOW', label: 'Fine, low density' })
    }
    const bleachCount = occurrencesOf(facts, 'BLEACH').filter(
      (h) => (h.monthsAgo ?? 99) <= 12,
    ).length
    if (bleachCount >= 3) {
      reasons.push({
        path: 'history[BLEACH]',
        value: bleachCount,
        label: 'Bleach in last 12 months',
      })
    }
    if (reasons.length === 0) return null

    const severe = reasons.length >= 2 || facts.hair.elasticity === 'POOR'

    return {
      flag: {
        code: 'EXTENSIONS_ON_FRAGILE_HAIR',
        severity: severe ? 'HIGH' : 'CAUTION',
        title: 'Extensions requested on compromised hair',
        detail:
          'Extension attachments apply sustained tension. On hair with poor elasticity, active ' +
          'breakage or very fine density this risks traction damage at the root and slippage at ' +
          'the attachment.',
        evidence: reasons,
        recommendedPath: severe
          ? 'Run a four to six week bond-repair and scalp programme first, then reassess in ' +
            'person. If integrity comes up, we install a lighter method with a reduced row count.'
          : 'Proceed with a reduced row count and a lighter attachment method, plus a two-week ' +
            'check-in to catch any tension early.',
        blocksOnlineBooking: severe,
      },
      complexity: { delta: severe ? 25 : 12, reason: 'Tension-bearing service on fragile hair' },
      duration: [
        {
          scope: 'TOTAL',
          op: 'ADD_MINUTES',
          value: 30,
          reason: 'Careful sectioning and tension assessment',
        },
      ],
      requirements: [
        {
          kind: 'IN_PERSON_CONSULT',
          dueBefore: 'BOOKING',
          rationale: 'Elasticity and density have to be assessed by hand.',
        },
      ],
      ...(severe
        ? {
            sessionPlan: {
              minSessions: 2,
              strategy: 'REPAIR_PROGRAM' as const,
              spacingDays: [{ minDays: 28, maxDays: 56 }],
              sessionLabels: ['Bond repair & assessment', 'Extension install'],
              rationale:
                'Repair first, install second — protects both the hair and the investment.',
            },
          }
        : {}),
      depositBandFloor: 2,
    }
  },
  docs: {
    rationale:
      'Traction damage from extensions on fragile hair is the most common source of ' +
      'extension-related complaints and refunds.',
    clientExplanation:
      'Your hair needs a little strengthening first so the extensions sit safely and last as long ' +
      'as they should.',
  },
}

const allergyOxidativeColour: Rule = {
  id: 'ALLERGY_OXIDATIVE_COLOUR',
  version: 1,
  category: 'ALLERGY',
  appliesWhen: (c) => wantsDye(c.facts),
  evaluate: ({ facts }) => {
    const ppd = facts.health.knownAllergies.includes('PPD')
    const priorReaction = facts.health.priorReactionToColor
    if (!ppd && !priorReaction) return null

    return {
      flag: {
        code: 'PRIOR_COLOUR_REACTION',
        severity: 'BLOCKER',
        title: 'Previous reaction to hair colour',
        detail:
          'A reported prior reaction or a known PPD allergy means no dye service can be booked ' +
          'online. Repeat exposure can escalate to a severe reaction.',
        evidence: [
          { path: 'health.priorReactionToColor', value: priorReaction, label: 'Prior reaction' },
          {
            path: 'health.knownAllergies',
            value: facts.health.knownAllergies,
            label: 'Known allergies',
          },
        ],
        recommendedPath:
          'Book a stylist consult. We can look at PPD-free and PTD-free lines, direct dyes or ' +
          'vegetable colour, and we will require a supervised patch test 48 hours before ' +
          'anything is applied.',
        blocksOnlineBooking: true,
      },
      complexity: { delta: 20, reason: 'Allergy history with a dye service' },
      requirements: [
        {
          kind: 'IN_PERSON_CONSULT',
          dueBefore: 'BOOKING',
          rationale: 'Allergy history must be reviewed by a stylist in person.',
        },
        {
          kind: 'PATCH_TEST',
          dueBefore: 'SESSION',
          sessionSequence: 1,
          leadHours: 48,
          rationale: 'Mandatory supervised patch test.',
        },
        {
          kind: 'FORM_SIGNATURE',
          dueBefore: 'SESSION',
          sessionSequence: 1,
          formTemplateKey: 'COLOUR_ALLERGY_WAIVER',
          rationale: 'Informed-consent record.',
        },
      ],
      forcesMode: 'IN_PERSON',
      depositBandFloor: 2,
    }
  },
  docs: {
    rationale:
      'The highest-liability item in a colour salon, and the one insurers care most about.',
    clientExplanation:
      'Because you have reacted to colour before, we want to talk it through in person and test ' +
      'carefully before we do anything.',
  },
}

const patchTestRequired: Rule = {
  id: 'PATCH_TEST_REQUIRED',
  version: 1,
  category: 'COMPLIANCE',
  appliesWhen: (c) => wantsDye(c.facts),
  evaluate: ({ facts }) => {
    // The allergy rule already imposes a stricter requirement.
    if (facts.health.knownAllergies.includes('PPD') || facts.health.priorReactionToColor)
      return null

    const irritated = ['IRRITATED', 'PSORIASIS', 'ECZEMA'].includes(facts.hair.scalpCondition)
    const severeSensitivity = facts.hair.scalpSensitivity === 'SEVERE'
    const valid = hasValidPatchTest(facts)

    if (valid && !irritated && !severeSensitivity) return null

    return {
      flag: {
        code: irritated ? 'ACTIVE_SCALP_CONDITION' : 'PATCH_TEST_REQUIRED',
        severity: irritated ? 'HIGH' : 'CAUTION',
        title: irritated
          ? 'Active scalp condition — scalp check and fresh patch test needed'
          : 'Patch test needed before this appointment',
        detail: irritated
          ? 'An active scalp condition raises both irritation risk and how much product the skin ' +
            'absorbs. We need a scalp check and a current patch test before applying colour.'
          : 'There is no valid patch test on file. One is required at least 48 hours before any ' +
            'dye service.',
        evidence: [
          {
            path: 'compliance.validPatchTestDaysRemaining',
            value: facts.compliance.validPatchTestDaysRemaining,
            label: 'Patch test on file',
          },
          {
            path: 'hair.scalpCondition',
            value: facts.hair.scalpCondition,
            label: 'Scalp condition',
          },
        ],
        recommendedPath:
          'Pop in for a five-minute patch test, then book any slot 48 or more hours later. We ' +
          'will hold your preferred time for 72 hours while you do.',
      },
      complexity: { delta: irritated ? 8 : 2, reason: 'Patch test and scalp gating' },
      requirements: [
        {
          kind: 'PATCH_TEST',
          dueBefore: 'BOOKING',
          leadHours: 48,
          rationale: 'Required lead time before a dye service.',
        },
      ],
      ...(irritated
        ? {
            duration: [
              {
                scope: 'TOTAL' as const,
                op: 'ADD_MINUTES' as const,
                value: 10,
                reason: 'Scalp assessment and barrier application',
              },
            ],
          }
        : {}),
    }
  },
  docs: {
    rationale:
      'Patch testing is a legal and insurance requirement in most markets, and the record of it ' +
      'is what protects the salon.',
    clientExplanation:
      'A quick patch test 48 hours beforehand keeps you safe. It takes five minutes.',
  },
}

const compromisedIntegrity: Rule = {
  id: 'COMPROMISED_INTEGRITY',
  version: 1,
  category: 'INTEGRITY',
  appliesWhen: (c) => c.facts.request.services.some((s) => s.isChemical),
  evaluate: ({ facts }) => {
    const signals = []
    if (facts.hair.gumminessReported) {
      signals.push({ path: 'hair.gumminessReported', value: true, label: 'Gumminess when wet' })
    }
    if (facts.hair.breakageReported) {
      signals.push({ path: 'hair.breakageReported', value: true, label: 'Breakage' })
    }
    if (facts.hair.splitEnds === 'severe') {
      signals.push({ path: 'hair.splitEnds', value: 'severe', label: 'Split ends' })
    }
    if (facts.hair.elasticity === 'POOR') {
      signals.push({ path: 'hair.elasticity', value: 'POOR', label: 'Elasticity' })
    }
    if (signals.length === 0) return null

    const severe = signals.length >= 2 || facts.hair.gumminessReported

    return {
      flag: {
        code: 'COMPROMISED_INTEGRITY',
        severity: severe ? 'HIGH' : 'CAUTION',
        title: 'Hair integrity is compromised',
        detail:
          'Gumminess when wet, active breakage or very poor elasticity mean the internal ' +
          'structure is already stressed. A chemical service on top of that is where hair fails ' +
          'in the bowl.',
        evidence: signals,
        recommendedPath: severe
          ? 'A four-week in-salon and at-home strengthening course first, then reassess. We will ' +
            'do a complimentary condition check at the end of it and plan from there.'
          : 'We will build a bond builder into the service and keep the processing gentle, then ' +
            'check in at two weeks.',
        blocksOnlineBooking: severe,
      },
      complexity: {
        delta: severe ? 20 : 10,
        reason: 'Compromised integrity before a chemical service',
      },
      duration: [
        {
          scope: 'TOTAL',
          op: 'ADD_MINUTES',
          value: 20,
          reason: 'Bond building and closer monitoring',
        },
      ],
      requirements: severe
        ? [
            {
              kind: 'TREATMENT_COURSE' as const,
              dueBefore: 'BOOKING' as const,
              rationale: 'Rebuild integrity before adding more chemical stress.',
            },
            {
              kind: 'IN_PERSON_CONSULT' as const,
              dueBefore: 'BOOKING' as const,
              rationale: 'Integrity has to be assessed by hand and by feel.',
            },
          ]
        : [],
      ...(severe
        ? {
            sessionPlan: {
              minSessions: 2,
              strategy: 'REPAIR_PROGRAM' as const,
              spacingDays: [{ minDays: 28, maxDays: 70 }],
              sessionLabels: ['Strengthening course & reassessment', 'Colour service'],
              rationale: 'Get the hair strong enough to take the service well.',
            },
          }
        : {}),
      depositBandFloor: severe ? 2 : 1,
    }
  },
  docs: {
    rationale:
      'Hair that fails mid-service is the most expensive outcome there is, in every sense.',
    clientExplanation:
      'Your hair is asking for some strengthening first. A few weeks of repair now means a much ' +
      'better colour result and no nasty surprises.',
  },
}

const relaxerPlusLightener: Rule = {
  id: 'RELAXER_PLUS_LIGHTENER',
  version: 1,
  category: 'CHEMICAL_HISTORY',
  appliesWhen: (c) => wantsLightening(c.facts),
  evaluate: ({ facts }) => {
    const relaxer = monthsSince(facts, 'RELAXER')
    const perm = monthsSince(facts, 'PERM')
    const recent = Math.min(relaxer, perm)
    if (recent > 12) return null

    return {
      flag: {
        code: 'RELAXER_PLUS_LIGHTENER',
        severity: recent <= 6 ? 'BLOCKER' : 'HIGH',
        title: 'Recent relaxer or perm with a lightening service',
        detail:
          'Relaxers and perms already break and reform the bonds in the hair. Lightening on top ' +
          'of chemically straightened or permed hair within a year is a well-known cause of ' +
          'severe breakage.',
        evidence: [
          { path: 'history[RELAXER].monthsAgo', value: relaxer, label: 'Last relaxer' },
          { path: 'history[PERM].monthsAgo', value: perm, label: 'Last perm' },
        ],
        recommendedPath:
          'We would wait until the chemically treated hair has grown out or been cut off, and in ' +
          'the meantime look at a demi-permanent gloss or lowlights, which add tone without ' +
          'lifting. Book a consult and we will map out the timing.',
        blocksOnlineBooking: recent <= 6,
      },
      complexity: { delta: 28, reason: 'Incompatible chemical services' },
      requirements: [
        {
          kind: 'IN_PERSON_CONSULT',
          dueBefore: 'BOOKING',
          rationale: 'Overlapping chemical services need a hands-on assessment.',
        },
        {
          kind: 'STRAND_TEST',
          dueBefore: 'BOOKING',
          rationale: 'Confirm the hair can take any lift at all.',
        },
      ],
      forcesMode: 'IN_PERSON',
      depositBandFloor: 3,
    }
  },
  docs: {
    rationale:
      'Lightener over a recent relaxer or perm is one of the few genuine "do not do this" ' +
      'combinations in hairdressing.',
    clientExplanation:
      'Relaxer and bleach together are hard on hair. Let us find a way to get you the look ' +
      'without the breakage.',
  },
}

const keratinBeforeColour: Rule = {
  id: 'KERATIN_TIMING_CONFLICT',
  version: 1,
  category: 'CHEMICAL_HISTORY',
  appliesWhen: (c) => wantsDye(c.facts) || wantsLightening(c.facts),
  evaluate: ({ facts }) => {
    const keratin = monthsSince(facts, 'KERATIN')
    if (keratin > 3) return null

    return {
      flag: {
        code: 'KERATIN_TIMING_CONFLICT',
        severity: 'CAUTION',
        title: 'Recent smoothing treatment',
        detail:
          'A keratin or smoothing treatment seals the cuticle. Colour applied over it takes ' +
          'unevenly and often fades fast, and lightening can strip the treatment you paid for.',
        evidence: [{ path: 'history[KERATIN].monthsAgo', value: keratin, label: 'Last smoothing' }],
        recommendedPath:
          'Colour first and smooth afterwards is the right order. If you would rather not wait, ' +
          'we can do a gloss now and plan the colour for when the treatment has softened.',
      },
      complexity: { delta: 8, reason: 'Cuticle sealed by a smoothing treatment' },
      duration: [
        {
          scope: { phaseKind: 'PROCESSING' },
          op: 'MULTIPLY',
          value: 1.15,
          reason: 'Slower uptake through a sealed cuticle',
        },
      ],
    }
  },
  docs: {
    rationale: 'Colour over fresh keratin is a common cause of "it faded in two weeks" complaints.',
    clientExplanation:
      'Your smoothing treatment is still fresh, which changes how colour takes. Here is the ' +
      'order we would recommend.',
  },
}

const greyCoverageResistant: Rule = {
  id: 'GREY_COVERAGE_RESISTANT',
  version: 1,
  category: 'GOAL_FEASIBILITY',
  appliesWhen: (c) => wantsDye(c.facts),
  evaluate: ({ facts }) => {
    const grey = facts.hair.greyPercent ?? 0
    if (grey < 50) return null
    const resistant = facts.hair.greyResistant === true

    return {
      flag: {
        code: 'GREY_COVERAGE_RESISTANT',
        severity: 'INFO',
        title: resistant ? 'Resistant grey needs extra processing' : 'Significant grey coverage',
        detail:
          `Around ${grey}% grey` +
          (resistant
            ? ', reported as resistant. Resistant grey needs a pre-softening step and a higher ' +
              'deposit of base pigment to hold.'
            : '. Coverage at this level needs a full base application rather than a gloss.'),
        evidence: [
          { path: 'hair.greyPercent', value: grey, label: 'Grey coverage' },
          { path: 'hair.greyResistant', value: resistant, label: 'Resistant' },
        ],
        recommendedPath:
          'We will use a coverage-weighted formula and allow extra processing time. If you have ' +
          'found colour fading quickly before, mention it and we will adjust the base.',
      },
      complexity: { delta: resistant ? 8 : 4, reason: 'Grey coverage requirements' },
      duration: [
        {
          scope: { phaseKind: 'PROCESSING' },
          op: 'ADD_MINUTES',
          value: resistant ? 15 : 5,
          reason: 'Coverage processing time',
        },
      ],
    }
  },
  docs: {
    rationale:
      'Under-timed grey coverage is the leading cause of a client returning within a fortnight.',
    clientExplanation:
      'We will build in the extra time your grey needs so the colour actually holds.',
  },
}

const unrealisticSingleSession: Rule = {
  id: 'UNREALISTIC_SINGLE_SESSION',
  version: 1,
  category: 'GOAL_FEASIBILITY',
  appliesWhen: (c) => wantsLightening(c.facts),
  evaluate: ({ facts }) => {
    const lift = requestedLift(facts)
    if (lift < 4) return null
    // The dedicated box-dye and black-to-platinum rules already cover those.
    if (occurrencesOf(facts, 'BOX_DYE').length > 0) return null
    if ((facts.goal.targetLevel ?? 0) >= 9 && startingLevel(facts) <= 4) return null

    return {
      flag: {
        code: 'UNREALISTIC_SINGLE_SESSION',
        severity: 'CAUTION',
        title: `A ${lift}-level lift is more than one comfortable session`,
        detail:
          'Lifting more than three or four levels at once puts the hair under real stress and ' +
          'usually leaves warmth that a toner can only partly correct.',
        evidence: [
          { path: 'hair.currentLevel', value: startingLevel(facts), label: 'Starting level' },
          { path: 'goal.targetLevel', value: facts.goal.targetLevel, label: 'Target level' },
        ],
        recommendedPath:
          'We would split this across two visits about eight weeks apart. You will leave the ' +
          'first one looking finished, just not quite at the final level.',
      },
      complexity: { delta: 12, reason: 'Lift beyond a comfortable single session' },
      sessionPlan: {
        minSessions: 2,
        strategy: 'GRADUAL_LIFT',
        spacingDays: [{ minDays: 42, maxDays: 84 }],
        sessionLabels: ['First lift & tone', 'Final lift & tone'],
        rationale: 'Two gentler lifts give a cleaner blonde than one aggressive one.',
      },
      depositBandFloor: 2,
    }
  },
  docs: {
    rationale: 'Sets expectations before the appointment rather than in the chair at hour three.',
    clientExplanation:
      'Big colour changes look best done in stages. You will still see a real difference on day one.',
  },
}

const minorRequiresGuardian: Rule = {
  id: 'MINOR_REQUIRES_GUARDIAN',
  version: 1,
  category: 'COMPLIANCE',
  appliesWhen: (c) => c.facts.isMinor && c.facts.request.services.some((s) => s.isChemical),
  evaluate: ({ facts }) => {
    if (facts.compliance.guardianConsentOnFile) return null
    return {
      flag: {
        code: 'MINOR_REQUIRES_GUARDIAN',
        severity: 'BLOCKER',
        title: 'Guardian consent required',
        detail: 'A chemical service for a minor requires signed guardian consent before booking.',
        evidence: [{ path: 'isMinor', value: true, label: 'Client is a minor' }],
        recommendedPath:
          'A parent or guardian can sign the consent form from the link we send. Once it is on ' +
          'file the booking opens up straight away.',
        blocksOnlineBooking: true,
      },
      complexity: { delta: 2, reason: 'Guardian consent outstanding' },
      requirements: [
        {
          kind: 'FORM_SIGNATURE',
          dueBefore: 'BOOKING',
          formTemplateKey: 'MINOR_GUARDIAN_CONSENT',
          rationale: 'Guardian consent is required for a minor’s chemical service.',
        },
      ],
    }
  },
  docs: {
    rationale: 'Straightforward liability and safeguarding requirement.',
    clientExplanation: 'We just need a parent or guardian to sign before we can book this in.',
  },
}

const stylistSkillBelowService: Rule = {
  id: 'STYLIST_SKILL_BELOW_SERVICE',
  version: 1,
  category: 'LOGISTICS',
  appliesWhen: (c) => c.facts.request.stylistRef !== null,
  evaluate: ({ facts }) => {
    const shortfalls = facts.request.services
      .filter((s) => s.requiredSkillCode && s.requiredSkillLevel)
      .filter(
        (s) => (facts.request.stylistSkills[s.requiredSkillCode!] ?? 0) < s.requiredSkillLevel!,
      )

    if (shortfalls.length === 0) return null

    return {
      flag: {
        code: 'STYLIST_SKILL_BELOW_SERVICE',
        severity: 'CAUTION',
        title: 'The requested stylist is not signed off for this service',
        detail:
          `${shortfalls.map((s) => s.name).join(', ')} requires a skill level the requested ` +
          `stylist has not been signed off for yet.`,
        evidence: shortfalls.map((s) => ({
          path: `request.services[${s.serviceId}].requiredSkillLevel`,
          value: s.requiredSkillLevel,
          label: s.name,
        })),
        recommendedPath:
          'We will suggest a colleague who specialises in this, or the requested stylist can do ' +
          'it with a senior stylist supervising. Both work — the front desk will confirm which.',
      },
      complexity: { delta: 5, reason: 'Specialist routing needed' },
    }
  },
  docs: {
    rationale: 'Routing by capability is cheaper than an unhappy client and a correction.',
    clientExplanation:
      'This service needs one of our specialists. We will make sure you are with the right person.',
  },
}

const deadlineTooTight: Rule = {
  id: 'DEADLINE_TOO_TIGHT',
  version: 1,
  category: 'LOGISTICS',
  appliesWhen: (c) => c.facts.goal.hardDeadlineDaysAway !== null,
  evaluate: ({ facts }) => {
    const days = facts.goal.hardDeadlineDaysAway!
    const lift = requestedLift(facts)
    const likelyMultiSession = lift >= 4 || occurrencesOf(facts, 'BOX_DYE').length > 0
    if (!likelyMultiSession || days > 90) return null

    return {
      flag: {
        code: 'DEADLINE_TOO_TIGHT',
        severity: days < 42 ? 'HIGH' : 'CAUTION',
        title: 'The date may be too close for this plan',
        detail:
          `This goal realistically needs staged sessions six to eight weeks apart, and the date ` +
          `you have given is ${days} days away.`,
        evidence: [
          { path: 'goal.hardDeadlineDaysAway', value: days, label: 'Days until the date' },
          { path: 'requestedLift', value: lift, label: 'Levels of lift' },
        ],
        recommendedPath:
          days < 42
            ? 'We would aim for a beautiful version of this rather than the full transformation — ' +
              'usually a softer, warmer blonde that suits the timeline and stays healthy. Book a ' +
              'consult this week and we will show you what is achievable.'
            : 'It is tight but workable if we start now. Let us book both sessions today so the ' +
              'spacing lands correctly.',
      },
      complexity: { delta: 6, reason: 'Deadline pressure against a staged plan' },
      requirements: [
        {
          kind: 'IN_PERSON_CONSULT',
          dueBefore: 'BOOKING',
          rationale: 'Expectations for a dated event should be set face to face.',
        },
      ],
    }
  },
  docs: {
    rationale:
      'The wedding-in-three-weeks conversation is the one most likely to end badly if it happens ' +
      'in the chair rather than beforehand.',
    clientExplanation:
      'We want you to look incredible on the day, so let us be realistic about timing.',
  },
}

const maintenanceMismatch: Rule = {
  id: 'MAINTENANCE_MISMATCH',
  version: 1,
  category: 'GOAL_FEASIBILITY',
  appliesWhen: (c) => wantsLightening(c.facts),
  evaluate: ({ facts }) => {
    if (facts.lifestyle.maintenanceAppetite !== 'LOW') return null
    const highUpkeep =
      facts.goal.wantsAllOver ||
      (facts.goal.targetLevel ?? 0) >= 9 ||
      facts.goal.contrastPreference === 'BOLD'
    if (!highUpkeep) return null

    return {
      flag: {
        code: 'MAINTENANCE_MISMATCH',
        severity: 'INFO',
        title: 'This look needs more upkeep than you asked for',
        detail:
          'You have told us you would prefer low maintenance, but an all-over or very light ' +
          'blonde needs a root touch-up roughly every six weeks plus regular toning.',
        evidence: [
          {
            path: 'lifestyle.maintenanceAppetite',
            value: 'LOW',
            label: 'Preferred upkeep',
          },
          { path: 'goal.targetLevel', value: facts.goal.targetLevel, label: 'Target level' },
        ],
        recommendedPath:
          'A root shadow or a balayage placement grows out softly and stretches to twelve weeks ' +
          'between visits. Same brightness through the ends, far less commitment.',
      },
      complexity: { delta: 2, reason: 'Upkeep expectation mismatch' },
    }
  },
  docs: {
    rationale:
      'Retention killer. Clients who feel trapped by upkeep do not rebook, and they blame the look.',
    clientExplanation:
      'There is a version of this that grows out beautifully and needs far fewer visits. Worth a look.',
  },
}

const swimmerBuildup: Rule = {
  id: 'SWIMMER_MINERAL_BUILDUP',
  version: 1,
  category: 'CHEMICAL_HISTORY',
  appliesWhen: (c) => wantsLightening(c.facts) || wantsDye(c.facts),
  evaluate: ({ facts }) => {
    if (!facts.lifestyle.swimsChlorinatedWeekly && !facts.lifestyle.hardWater) return null
    return {
      flag: {
        code: 'SWIMMER_MINERAL_BUILDUP',
        severity: 'INFO',
        title: 'Mineral build-up will affect the result',
        detail:
          'Chlorine and hard water leave copper and calcium in the hair. These react with ' +
          'lightener and pull tone green or brassy in a way the formula alone cannot fix.',
        evidence: [
          {
            path: 'lifestyle.swimsChlorinatedWeekly',
            value: facts.lifestyle.swimsChlorinatedWeekly,
            label: 'Swims weekly',
          },
          { path: 'lifestyle.hardWater', value: facts.lifestyle.hardWater, label: 'Hard water' },
        ],
        recommendedPath:
          'We will add a chelating treatment at the start of the appointment. It takes about ' +
          'fifteen minutes and makes a visible difference to how clean the tone comes out.',
      },
      complexity: { delta: 4, reason: 'Mineral build-up' },
      duration: [{ scope: 'TOTAL', op: 'ADD_MINUTES', value: 15, reason: 'Chelating treatment' }],
    }
  },
  docs: {
    rationale:
      'A cheap, high-impact catch — the difference between a clean blonde and a green one.',
    clientExplanation:
      'Swimming and hard water leave minerals behind. A quick treatment first makes your colour ' +
      'come out much cleaner.',
  },
}

const insufficientPhotos: Rule = {
  id: 'INSUFFICIENT_PHOTOS',
  version: 1,
  category: 'DATA_QUALITY',
  evaluate: ({ facts }) => {
    const missing = facts.photos.missingRequiredViews
    const poorQuality = (facts.photos.lowestQualityScore ?? 1) < 0.4
    if (missing.length === 0 && !poorQuality) return null

    return {
      flag: {
        code: 'INSUFFICIENT_PHOTOS',
        severity: 'CAUTION',
        title: 'We need a couple more photos to be confident',
        detail:
          missing.length > 0
            ? `Missing: ${missing.join(', ')}. Without these the estimate is a guess, particularly ` +
              `on how the ends are sitting.`
            : 'The photos provided are too low quality to assess condition and tone reliably.',
        evidence: [
          { path: 'photos.missingRequiredViews', value: missing, label: 'Missing views' },
          {
            path: 'photos.lowestQualityScore',
            value: facts.photos.lowestQualityScore,
            label: 'Lowest photo quality',
          },
        ],
        recommendedPath:
          'Add the missing angles in good daylight, ideally without a filter. It takes a minute ' +
          'and it is the difference between a real quote and a rough one.',
      },
      complexity: { delta: 0, reason: 'Incomplete photo set' },
      requirements: [
        {
          kind: 'PHOTO_RESUBMIT',
          dueBefore: 'BOOKING',
          rationale: 'Complete the guided photo set so the estimate can be trusted.',
        },
      ],
    }
  },
  docs: {
    rationale:
      'Lowers estimate confidence rather than blocking. Missing photos are a data problem, not a ' +
      'hair problem, and should never read as a refusal.',
    clientExplanation:
      'A couple more photos and we can give you a proper answer rather than a guess.',
  },
}

export const RULES: readonly Rule[] = [
  boxDyeHighLift,
  hennaLightenerConflict,
  blackBoxToPlatinum,
  extensionsOnFragileHair,
  allergyOxidativeColour,
  patchTestRequired,
  compromisedIntegrity,
  relaxerPlusLightener,
  keratinBeforeColour,
  greyCoverageResistant,
  unrealisticSingleSession,
  minorRequiresGuardian,
  stylistSkillBelowService,
  deadlineTooTight,
  maintenanceMismatch,
  swimmerBuildup,
  insufficientPhotos,
]

export const RULESET: Ruleset = {
  version: 'v2026-01-01',
  rules: RULES,
  settings: DEFAULT_ENGINE_SETTINGS,
}
