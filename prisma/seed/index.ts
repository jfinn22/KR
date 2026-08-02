import { PrismaClient } from '@prisma/client'
import bcrypt from 'bcryptjs'

/**
 * Aurora Hair Studio — the demo salon.
 *
 * Fully deterministic: no faker, no Math.random, no clock-dependent ids. The
 * same command always produces the same database, which is what lets end-to-end
 * tests assert against it rather than building their own state.
 *
 * It is also the cheapest schema canary there is. CI runs it before e2e, so a
 * migration that breaks a relation fails here rather than in production.
 */

const db = new PrismaClient()

const PASSWORD = 'salon1234'
const TZ = 'America/New_York'

/** A fixed reference point, so relative dates never drift between runs. */
const EPOCH = new Date('2026-08-03T09:00:00Z')
const day = (offset: number) => new Date(EPOCH.getTime() + offset * 86_400_000)

/** Deterministic pseudo-random in [0,1) from a string. Replaces faker. */
function rand(seed: string): number {
  let hash = 2166136261
  for (let i = 0; i < seed.length; i++) {
    hash ^= seed.charCodeAt(i)
    hash = Math.imul(hash, 16777619)
  }
  return ((hash >>> 0) % 100000) / 100000
}

const pick = <T>(seed: string, options: readonly T[]): T =>
  options[Math.floor(rand(seed) * options.length)] ?? options[0]!

async function main() {
  console.log('▸ Seeding Aurora Hair Studio…')

  // Wipe only what this seed owns, so it is safe to re-run. Matching on the
  // domain rather than '@aurora.test' matters: the second salon's owner is
  // owner@bloom.aurora.test, which the stricter pattern misses — leaving a
  // user behind that the next run collides with on the unique email.
  await db.salon.deleteMany({ where: { slug: { in: ['aurora', 'bloom', 'solo'] } } })
  await db.user.deleteMany({ where: { email: { endsWith: 'aurora.test' } } })

  // --- Plans ---------------------------------------------------------------
  const plans = [
    { code: 'STARTER' as const, name: 'Starter', monthly: 2900, yearly: 29000, loc: 1, sty: 1 },
    { code: 'PRO' as const, name: 'Pro', monthly: 8900, yearly: 89000, loc: 1, sty: 8 },
    { code: 'SALON' as const, name: 'Salon', monthly: 19900, yearly: 199000, loc: 25, sty: 100 },
  ]
  for (const [index, plan] of plans.entries()) {
    await db.plan.upsert({
      where: { code: plan.code },
      update: {},
      create: {
        code: plan.code,
        name: plan.name,
        descriptionText: `${plan.name} plan`,
        monthlyPriceCents: plan.monthly,
        yearlyPriceCents: plan.yearly,
        maxLocations: plan.loc,
        maxStylists: plan.sty,
        featuresJson: {},
        sortOrder: index,
      },
    })
  }

  const passwordHash = await bcrypt.hash(PASSWORD, 10)

  // --- The salon -----------------------------------------------------------
  const salon = await db.salon.create({
    data: {
      slug: 'aurora',
      name: 'Aurora Hair Studio',
      defaultTimezone: TZ,
      contactEmail: 'hello@aurora.test',
      contactPhone: '+15551000000',
      settings: {
        create: {
          slotGranularityMin: 15,
          minBookingLeadMin: 120,
          allowFinishAfterCloseMin: 15,
          // Off by default. It is the highest-variance feature in the product
          // and a salon should turn it on deliberately.
          interleaveEnabled: false,
          consultationSlaHours: 24,
          // On, so the demo shows the complete self-serve loop: a cut consults,
          // approves and books with nobody in the middle, while anything the
          // engine flags still waits for a stylist. Both halves matter — a demo
          // where everything queues for review hides the point of the rules.
          autoApproveSimple: true,
        },
      },
      subscription: {
        create: { planCode: 'SALON', status: 'ACTIVE', seats: 8, currentPeriodEnd: day(30) },
      },
    },
  })

  const mainLocation = await db.location.create({
    data: {
      salonId: salon.id,
      name: 'Aurora — Downtown',
      timezone: TZ,
      addressLine1: '18 Marchmont Street',
      city: 'New York',
      region: 'NY',
      postalCode: '10012',
      isActive: true,
    },
  })

  // A second location in another timezone, so multi-site and DST handling are
  // exercised by the demo rather than only by tests.
  const westLocation = await db.location.create({
    data: {
      salonId: salon.id,
      name: 'Aurora — Riverside',
      timezone: 'America/Chicago',
      city: 'Chicago',
      region: 'IL',
      isActive: true,
    },
  })

  for (const [index, name] of ['Chair 1', 'Chair 2', 'Chair 3', 'Chair 4'].entries()) {
    await db.resource.create({
      data: {
        salonId: salon.id,
        locationId: mainLocation.id,
        type: 'CHAIR',
        name,
        sortOrder: index,
      },
    })
  }
  for (const name of ['Basin 1', 'Basin 2']) {
    await db.resource.create({
      data: { salonId: salon.id, locationId: mainLocation.id, type: 'BASIN', name },
    })
  }
  for (const name of ['Processing seat 1', 'Processing seat 2', 'Processing seat 3']) {
    await db.resource.create({
      data: { salonId: salon.id, locationId: mainLocation.id, type: 'PROCESSING_SEAT', name },
    })
  }
  await db.resource.create({
    data: { salonId: salon.id, locationId: westLocation.id, type: 'CHAIR', name: 'Chair 1' },
  })

  // Salon opening hours: Tuesday to Saturday.
  for (const dayOfWeek of [2, 3, 4, 5, 6]) {
    await db.workingHours.create({
      data: {
        salonId: salon.id,
        locationId: mainLocation.id,
        dayOfWeek,
        startMinute: dayOfWeek === 6 ? 9 * 60 : 9 * 60,
        endMinute: dayOfWeek === 6 ? 17 * 60 : 19 * 60,
      },
    })
  }

  // --- Catalog -------------------------------------------------------------
  const colour = await db.serviceCategory.create({
    data: { salonId: salon.id, name: 'Colour', slug: 'colour', sortOrder: 0 },
  })
  const cutting = await db.serviceCategory.create({
    data: { salonId: salon.id, name: 'Cutting & styling', slug: 'cutting', sortOrder: 1 },
  })
  const extensions = await db.serviceCategory.create({
    data: { salonId: salon.id, name: 'Extensions', slug: 'extensions', sortOrder: 2 },
  })
  const treatments = await db.serviceCategory.create({
    data: { salonId: salon.id, name: 'Treatments', slug: 'treatments', sortOrder: 3 },
  })

  const depositStandard = await db.depositPolicy.create({
    data: {
      salonId: salon.id,
      name: 'Standard',
      mode: 'PERCENT',
      percentBps: 2000,
      minCents: 2500,
      refundableUntilHours: 48,
      isDefault: true,
    },
  })
  const depositHighRisk = await db.depositPolicy.create({
    data: {
      salonId: salon.id,
      name: 'Corrective / high risk',
      mode: 'PERCENT',
      percentBps: 5000,
      minCents: 10000,
      refundableUntilHours: 72,
    },
  })

  interface ServiceSeed {
    name: string
    slug: string
    categoryId: string
    price: number
    complexity: number
    chemical?: boolean
    lightening?: boolean
    dye?: boolean
    extensionInstall?: boolean
    consult?: boolean
    patchTest?: boolean
    skill?: [string, number]
    deposit?: string
    phases: {
      kind: 'ACTIVE' | 'PROCESSING' | 'RINSE'
      label: string
      min: number
      stylist: boolean
      resource: 'CHAIR' | 'BASIN' | 'PROCESSING_SEAT' | null
      scalable: boolean
    }[]
  }

  const active = (label: string, min: number, scalable = true) => ({
    kind: 'ACTIVE' as const,
    label,
    min,
    stylist: true,
    resource: 'CHAIR' as const,
    scalable,
  })
  const processing = (min: number) => ({
    kind: 'PROCESSING' as const,
    label: 'Processing',
    min,
    stylist: false,
    resource: 'PROCESSING_SEAT' as const,
    scalable: false,
  })
  const rinse = (min: number) => ({
    kind: 'RINSE' as const,
    label: 'Rinse & condition',
    min,
    stylist: true,
    resource: 'BASIN' as const,
    scalable: false,
  })

  const services: ServiceSeed[] = [
    {
      name: 'Full balayage',
      slug: 'full-balayage',
      categoryId: colour.id,
      price: 22000,
      complexity: 15,
      chemical: true,
      lightening: true,
      consult: true,
      patchTest: true,
      skill: ['BALAYAGE', 3],
      deposit: depositStandard.id,
      phases: [active('Application', 90), processing(40), rinse(15), active('Tone & finish', 45)],
    },
    {
      name: 'Colour correction',
      slug: 'colour-correction',
      categoryId: colour.id,
      price: 45000,
      complexity: 40,
      chemical: true,
      lightening: true,
      dye: true,
      consult: true,
      patchTest: true,
      skill: ['COLOR_CORRECTION', 4],
      deposit: depositHighRisk.id,
      phases: [active('Removal & first lift', 120), processing(45), rinse(20), active('Tone', 60)],
    },
    {
      name: 'Root touch-up',
      slug: 'root-touch-up',
      categoryId: colour.id,
      price: 9000,
      complexity: 4,
      chemical: true,
      dye: true,
      patchTest: true,
      deposit: depositStandard.id,
      phases: [
        { ...active('Application', 30), scalable: false },
        processing(35),
        rinse(10),
        active('Blow-dry', 25),
      ],
    },
    {
      name: 'Gloss & tone',
      slug: 'gloss',
      categoryId: colour.id,
      price: 7500,
      complexity: 2,
      chemical: true,
      dye: true,
      patchTest: true,
      phases: [active('Application', 15, false), processing(20), rinse(10), active('Finish', 15)],
    },
    {
      name: 'Half-head foils',
      slug: 'half-head-foils',
      categoryId: colour.id,
      price: 15500,
      complexity: 10,
      chemical: true,
      lightening: true,
      patchTest: true,
      skill: ['FOILS', 2],
      deposit: depositStandard.id,
      phases: [active('Foiling', 60), processing(35), rinse(15), active('Tone & finish', 30)],
    },
    {
      name: 'Cut & finish',
      slug: 'cut-finish',
      categoryId: cutting.id,
      price: 6500,
      complexity: 2,
      phases: [active('Cut & finish', 45)],
    },
    {
      name: 'Restyle consultation & cut',
      slug: 'restyle',
      categoryId: cutting.id,
      price: 9500,
      complexity: 5,
      consult: true,
      phases: [active('Consult & cut', 75)],
    },
    {
      name: 'Blow-dry',
      slug: 'blow-dry',
      categoryId: cutting.id,
      price: 4500,
      complexity: 1,
      phases: [active('Blow-dry', 40)],
    },
    {
      name: 'Tape-in extensions — full head',
      slug: 'tape-in-full',
      categoryId: extensions.id,
      price: 48000,
      complexity: 18,
      extensionInstall: true,
      consult: true,
      skill: ['EXTENSIONS_TAPE', 3],
      deposit: depositHighRisk.id,
      phases: [active('Install', 120), active('Blend & finish', 30)],
    },
    {
      name: 'Extension maintenance',
      slug: 'extension-maintenance',
      categoryId: extensions.id,
      price: 14000,
      complexity: 6,
      extensionInstall: true,
      skill: ['EXTENSIONS_TAPE', 2],
      phases: [active('Remove & refit', 90)],
    },
    {
      name: 'Bond-building treatment',
      slug: 'bond-treatment',
      categoryId: treatments.id,
      price: 5500,
      complexity: 1,
      phases: [active('Apply', 15, false), processing(20), rinse(10)],
    },
    {
      name: 'Scalp & clarifying treatment',
      slug: 'scalp-treatment',
      categoryId: treatments.id,
      price: 4800,
      complexity: 1,
      phases: [active('Apply & massage', 25, false), rinse(10)],
    },
  ]

  const serviceIds = new Map<string, string>()

  for (const [index, spec] of services.entries()) {
    const created = await db.service.create({
      data: {
        salonId: salon.id,
        categoryId: spec.categoryId,
        name: spec.name,
        slug: spec.slug,
        description: `${spec.name} at Aurora Hair Studio.`,
        basePriceCents: spec.price,
        baseComplexity: spec.complexity,
        isChemical: spec.chemical ?? false,
        isLightening: spec.lightening ?? false,
        containsDye: spec.dye ?? false,
        isExtensionInstall: spec.extensionInstall ?? false,
        requiresConsultation: spec.consult ?? false,
        requiresPatchTest: spec.patchTest ?? false,
        requiredSkillCode: spec.skill?.[0] ?? null,
        requiredSkillLevel: spec.skill?.[1] ?? null,
        depositPolicyId: spec.deposit ?? null,
        bufferAfterMin: 10,
        sortOrder: index,
        phases: {
          create: spec.phases.map((phase, sequence) => ({
            salonId: salon.id,
            sequence,
            kind: phase.kind,
            label: phase.label,
            durationMin: phase.min,
            requiresStylist: phase.stylist,
            requiresResourceType: phase.resource,
            isScalable: phase.scalable,
          })),
        },
        variants: {
          create: [
            {
              salonId: salon.id,
              key: 'LONG',
              label: 'Long hair',
              durationDeltaMin: 30,
              priceDeltaCents: 2500,
              sortOrder: 1,
            },
            {
              salonId: salon.id,
              key: 'EXTRA_LONG',
              label: 'Extra long',
              durationDeltaMin: 60,
              priceDeltaCents: 5000,
              sortOrder: 2,
            },
          ],
        },
      },
    })
    serviceIds.set(spec.slug, created.id)
  }

  // Hair-factor modifiers, so duration reflects the head in the chair.
  for (const [value, deltaMin] of [
    ['SHOULDER', 0],
    ['COLLARBONE', 10],
    ['MID_BACK', 25],
    ['WAIST', 40],
  ] as const) {
    await db.serviceModifier.create({
      data: {
        salonId: salon.id,
        categoryId: colour.id,
        factorKey: 'HAIR_LENGTH',
        factorValue: value,
        deltaMin,
        appliesTo: 'DURATION',
      },
    })
  }

  // --- People --------------------------------------------------------------
  interface StaffSeed {
    email: string
    name: string
    role: 'OWNER' | 'MANAGER' | 'FRONT_DESK' | 'STYLIST'
    title?: string
    skills?: [string, number][]
    days?: number[]
    /** Deliberately divergent, so calibration has something real to show. */
    pace?: number
  }

  const staff: StaffSeed[] = [
    {
      email: 'owner@aurora.test',
      name: 'Nadia Okonkwo',
      role: 'OWNER',
      title: 'Owner & creative director',
      skills: [
        ['BALAYAGE', 5],
        ['COLOR_CORRECTION', 5],
        ['FOILS', 5],
      ],
      days: [2, 3, 4, 5],
      pace: 0.92,
    },
    {
      email: 'manager@aurora.test',
      name: 'Theo Marsh',
      role: 'MANAGER',
      title: 'Salon manager',
      skills: [
        ['BALAYAGE', 4],
        ['FOILS', 4],
      ],
      days: [2, 3, 4, 5, 6],
      pace: 1.0,
    },
    {
      email: 'frontdesk@aurora.test',
      name: 'Priya Raman',
      role: 'FRONT_DESK',
      title: 'Front of house',
      days: [2, 3, 4, 5, 6],
    },
    {
      email: 'rowan@aurora.test',
      name: 'Rowan Ellis',
      role: 'STYLIST',
      title: 'Senior colourist',
      skills: [
        ['BALAYAGE', 5],
        ['COLOR_CORRECTION', 4],
        ['FOILS', 5],
      ],
      days: [2, 3, 4, 5, 6],
      pace: 1.24,
    },
    {
      email: 'sam@aurora.test',
      name: 'Sam Delgado',
      role: 'STYLIST',
      title: 'Extensions specialist',
      skills: [
        ['EXTENSIONS_TAPE', 5],
        ['BALAYAGE', 3],
      ],
      days: [3, 4, 5, 6],
      pace: 0.87,
    },
    {
      email: 'junior@aurora.test',
      name: 'Alex Whitfield',
      role: 'STYLIST',
      title: 'Junior stylist',
      skills: [
        ['FOILS', 2],
        ['BALAYAGE', 2],
      ],
      days: [2, 3, 4, 5],
      pace: 1.18,
    },
  ]

  const stylistIds: { id: string; pace: number; name: string }[] = []

  for (const person of staff) {
    const user = await db.user.create({
      data: {
        email: person.email,
        name: person.name,
        passwordHash,
        emailVerified: EPOCH,
        timezone: TZ,
      },
    })

    const membership = await db.membership.create({
      data: { salonId: salon.id, userId: user.id, role: person.role, status: 'ACTIVE' },
    })

    if (person.role === 'FRONT_DESK') continue

    const profile = await db.stylistProfile.create({
      data: {
        salonId: salon.id,
        membershipId: membership.id,
        displayName: person.name,
        title: person.title ?? null,
        bio: `${person.name} at Aurora Hair Studio.`,
        defaultLocationId: mainLocation.id,
        acceptsNewClients: person.email !== 'owner@aurora.test',
        maxDailyChemicalServices: 5,
      },
    })

    for (const [code, level] of person.skills ?? []) {
      await db.stylistSkill.create({
        data: { salonId: salon.id, stylistProfileId: profile.id, skillCode: code, level },
      })
    }

    for (const dayOfWeek of person.days ?? []) {
      await db.workingHours.create({
        data: {
          salonId: salon.id,
          stylistProfileId: profile.id,
          dayOfWeek,
          startMinute: 9 * 60,
          endMinute: dayOfWeek === 6 ? 17 * 60 : 18 * 60,
        },
      })
    }

    // Every stylist can perform every service they are qualified for.
    for (const [slug, serviceId] of serviceIds) {
      const spec = services.find((s) => s.slug === slug)!
      const qualified =
        !spec.skill ||
        (person.skills ?? []).some(
          ([code, level]) => code === spec.skill![0] && level >= spec.skill![1],
        )
      await db.stylistService.create({
        data: {
          salonId: salon.id,
          stylistProfileId: profile.id,
          serviceId,
          isEnabled: qualified,
        },
      })
    }

    stylistIds.push({ id: profile.id, pace: person.pace ?? 1, name: person.name })
  }

  // --- Clients -------------------------------------------------------------
  const firstNames = [
    'Ada',
    'Mira',
    'Jonah',
    'Elise',
    'Cass',
    'Ines',
    'Rafa',
    'Nell',
    'Tomas',
    'Wren',
  ]
  const lastNames = [
    'Rivera',
    'Nakamura',
    'Okafor',
    'Bright',
    'Halloran',
    'Vance',
    'Sorensen',
    'Adeyemi',
  ]

  const clientIds: string[] = []

  for (let n = 0; n < 40; n++) {
    const seed = `client-${n}`
    const first = pick(`${seed}-f`, firstNames)
    const last = pick(`${seed}-l`, lastNames)

    const client = await db.clientProfile.create({
      data: {
        salonId: salon.id,
        firstName: first,
        lastName: `${last}${n}`,
        email: `client${n}@aurora.test`,
        phone: `+1555200${String(n).padStart(4, '0')}`,
        completedVisits: Math.floor(rand(`${seed}-v`) * 12),
        noShowCount: rand(`${seed}-ns`) > 0.88 ? 2 : 0,
        lastVisitAt: day(-Math.floor(rand(`${seed}-lv`) * 180)),
        contactConsents: {
          create: [
            { salonId: salon.id, channel: 'SMS', purpose: 'TRANSACTIONAL', status: 'GRANTED' },
            { salonId: salon.id, channel: 'EMAIL', purpose: 'TRANSACTIONAL', status: 'GRANTED' },
          ],
        },
        hairProfile: {
          create: {
            salonId: salon.id,
            naturalLevel: 3 + Math.floor(rand(`${seed}-nl`) * 5),
            currentLevelRoots: 3 + Math.floor(rand(`${seed}-cr`) * 5),
            currentLevelMids: 4 + Math.floor(rand(`${seed}-cm`) * 5),
            currentLevelEnds: 4 + Math.floor(rand(`${seed}-ce`) * 5),
            texture: pick(`${seed}-t`, ['FINE', 'MEDIUM', 'COARSE'] as const),
            density: pick(`${seed}-d`, ['LOW', 'MEDIUM', 'HIGH'] as const),
            porosity: pick(`${seed}-p`, ['LOW', 'NORMAL', 'HIGH'] as const),
            elasticity: pick(`${seed}-e`, ['GOOD', 'FAIR', 'POOR'] as const),
            lengthCategory: pick(`${seed}-len`, ['SHOULDER', 'COLLARBONE', 'MID_BACK'] as const),
            greyPercent: Math.floor(rand(`${seed}-g`) * 70),
            hasBoxDye: rand(`${seed}-bd`) > 0.7,
            boxDyeLastAt: rand(`${seed}-bd`) > 0.7 ? day(-120) : null,
            scalpSensitivity: pick(`${seed}-ss`, ['NONE', 'NONE', 'MILD', 'MODERATE'] as const),
          },
        },
        loyaltyAccount: {
          create: { salonId: salon.id, pointsBalance: Math.floor(rand(`${seed}-lp`) * 400) },
        },
      },
    })
    clientIds.push(client.id)
  }

  // One client with a login, for the end-to-end client journey.
  const clientUser = await db.user.create({
    data: {
      email: 'client@aurora.test',
      name: 'Ada Rivera',
      passwordHash,
      emailVerified: EPOCH,
    },
  })
  await db.clientProfile.update({
    where: { id: clientIds[0]! },
    data: {
      userId: clientUser.id,
      email: 'client@aurora.test',
      firstName: 'Ada',
      lastName: 'Rivera',
    },
  })

  // --- History, so analytics and calibration have real inputs --------------
  let appointments = 0
  for (let n = 0; n < 120; n++) {
    const seed = `appt-${n}`
    const stylist = stylistIds[Math.floor(rand(`${seed}-s`) * stylistIds.length)]!
    const clientId = clientIds[Math.floor(rand(`${seed}-c`) * clientIds.length)]!
    const slug = pick(`${seed}-svc`, [...serviceIds.keys()])
    const serviceId = serviceIds.get(slug)!
    const spec = services.find((s) => s.slug === slug)!

    const daysAgo = 1 + Math.floor(rand(`${seed}-d`) * 170)
    const startsAt = new Date(
      day(-daysAgo).setUTCHours(13 + Math.floor(rand(`${seed}-h`) * 5), 0, 0, 0),
    )
    const estimated = spec.phases.reduce((sum, p) => sum + p.min, 0)
    // Actual time varies around the stylist's own pace — this is what makes the
    // quote-accuracy dashboard show something real.
    const actual = Math.round(estimated * stylist.pace * (0.9 + rand(`${seed}-a`) * 0.25))
    const endsAt = new Date(startsAt.getTime() + estimated * 60_000)

    const appointment = await db.appointment.create({
      data: {
        salonId: salon.id,
        locationId: mainLocation.id,
        clientProfileId: clientId,
        primaryStylistId: stylist.id,
        status: 'COMPLETED',
        source: 'CLIENT_PORTAL',
        startsAt,
        endsAt,
        chairStartedAt: startsAt,
        chairEndedAt: new Date(startsAt.getTime() + actual * 60_000),
        checkedOutAt: new Date(startsAt.getTime() + actual * 60_000),
        estimatedDurationMin: estimated,
        estimatedTotalCents: spec.price,
        actualTotalCents: spec.price,
        services: {
          create: {
            salonId: salon.id,
            serviceId,
            stylistProfileId: stylist.id,
            sequence: 0,
            plannedDurationMin: estimated,
            actualDurationMin: actual,
            priceCents: spec.price,
          },
        },
      },
    })

    await db.quoteAccuracy.create({
      data: {
        salonId: salon.id,
        appointmentId: appointment.id,
        stylistProfileId: stylist.id,
        serviceIds: [serviceId],
        estimatedDurationMin: estimated,
        actualDurationMin: actual,
        estimatedPriceCents: spec.price,
        actualPriceCents: spec.price,
        overranByMin: actual - estimated,
        computedAt: endsAt,
      },
    })

    if (spec.chemical) {
      await db.formula.create({
        data: {
          salonId: salon.id,
          clientProfileId: clientId,
          appointmentId: appointment.id,
          stylistProfileId: stylist.id,
          purpose: spec.lightening ? 'LIGHTENER' : 'ROOT_TOUCH_UP',
          developerVolume: pick(`${seed}-dv`, [10, 20, 30]),
          ratio: '1:2',
          processingTimeMin: 35,
          technique: spec.lightening ? 'Freehand balayage' : 'Root application',
          resultRating: 4,
          components: {
            create: [
              {
                salonId: salon.id,
                sequence: 0,
                brand: 'Aurora Pro',
                shadeCode: `${6 + Math.floor(rand(`${seed}-sc`) * 3)}N`,
                role: 'BASE',
                grams: 40,
              },
            ],
          },
        },
      })
    }

    await db.hairHistoryEvent.create({
      data: {
        salonId: salon.id,
        clientProfileId: clientId,
        occurredAt: startsAt,
        type: 'SERVICE',
        title: spec.name,
        summary: `${spec.name} with ${stylist.name}.`,
        appointmentId: appointment.id,
        source: 'STYLIST',
      },
    })

    appointments++
  }

  // --- Consultation template ----------------------------------------------
  const template = await db.consultationTemplate.create({
    data: {
      salonId: salon.id,
      key: 'colour-consultation',
      version: 1,
      name: 'Colour consultation',
      status: 'PUBLISHED',
      appliesToServiceIds: [serviceIds.get('full-balayage')!, serviceIds.get('colour-correction')!],
    },
  })

  const questions: {
    key: string
    section: string
    prompt: string
    inputType: 'SINGLE_SELECT' | 'BOOLEAN' | 'NUMBER' | 'LONG_TEXT' | 'LEVEL_PICKER' | 'DATE'
    factKey?: string
    options?: string[]
    visibleWhen?: unknown
  }[] = [
    {
      key: 'goal_level',
      section: 'Your goal',
      prompt: 'How light would you like to go?',
      inputType: 'LEVEL_PICKER',
      factKey: 'goal.targetLevel',
    },
    {
      key: 'natural_level',
      section: 'Your hair',
      prompt: 'What is your natural level?',
      inputType: 'LEVEL_PICKER',
      factKey: 'hair.naturalLevel',
    },
    {
      key: 'box_dye',
      section: 'History',
      prompt: 'Have you ever used box dye?',
      inputType: 'BOOLEAN',
      factKey: 'history.boxDye.ever',
    },
    {
      key: 'box_dye_when',
      section: 'History',
      prompt: 'Roughly when was the most recent box dye?',
      inputType: 'DATE',
      factKey: 'history.boxDye.monthsAgo',
      // Conditional logic: only asked if the answer above was yes.
      visibleWhen: { '==': [{ var: 'box_dye' }, true] },
    },
    {
      key: 'henna',
      section: 'History',
      prompt: 'Have you ever used henna?',
      inputType: 'BOOLEAN',
      factKey: 'history.henna.ever',
    },
    {
      key: 'bleach',
      section: 'History',
      prompt: 'Has your hair been bleached before?',
      inputType: 'BOOLEAN',
      factKey: 'history.bleach.ever',
    },
    {
      key: 'reaction',
      section: 'Safety',
      prompt: 'Have you ever reacted to hair colour?',
      inputType: 'BOOLEAN',
      factKey: 'health.priorReactionToColor',
    },
    {
      key: 'scalp',
      section: 'Safety',
      prompt: 'How sensitive is your scalp?',
      inputType: 'SINGLE_SELECT',
      factKey: 'hair.scalpSensitivity',
      options: ['NONE', 'MILD', 'MODERATE', 'SEVERE'],
    },
    {
      key: 'breakage',
      section: 'Condition',
      prompt: 'Are you seeing any breakage?',
      inputType: 'BOOLEAN',
      factKey: 'hair.breakageReported',
    },
    {
      key: 'notes',
      section: 'Anything else',
      prompt: 'Anything else we should know?',
      inputType: 'LONG_TEXT',
    },
  ]

  for (const [sortOrder, question] of questions.entries()) {
    await db.consultationQuestion.create({
      data: {
        salonId: salon.id,
        templateId: template.id,
        key: question.key,
        section: question.section,
        sortOrder,
        prompt: question.prompt,
        inputType: question.inputType,
        factKey: question.factKey ?? null,
        optionsJson: question.options ? { options: question.options } : undefined,
        visibleWhenJson: (question.visibleWhen ?? undefined) as never,
        isRequired: question.inputType !== 'LONG_TEXT',
      },
    })
  }

  // --- Messaging and reminders --------------------------------------------
  const reminderTemplate = await db.messageTemplate.create({
    data: {
      salonId: salon.id,
      key: 'appointment-reminder',
      name: 'Appointment reminder',
      channel: 'SMS',
      body: 'Hi {{client.firstName}}, a reminder about your appointment at Aurora tomorrow. Reply STOP to opt out.',
      isActive: true,
    },
  })

  await db.notificationSchedule.create({
    data: {
      salonId: salon.id,
      key: 'reminder-24h',
      trigger: 'APPOINTMENT_BEFORE',
      offsetMinutes: -1440,
      channel: 'SMS',
      templateId: reminderTemplate.id,
      isEnabled: true,
    },
  })

  // --- Consent forms (non-legal placeholders) ------------------------------
  const forms = [
    ['CHEMICAL_SERVICE_CONSENT', 'Chemical service consent', 'CHEMICAL_SERVICE'],
    ['COLOUR_ALLERGY_WAIVER', 'Colour allergy waiver', 'WAIVER'],
    ['PATCH_TEST_CONSENT', 'Patch test consent', 'PATCH_TEST'],
    ['PHOTO_RELEASE', 'Photo release', 'PHOTO_RELEASE'],
    ['MINOR_GUARDIAN_CONSENT', 'Guardian consent', 'MINOR_GUARDIAN'],
  ] as const

  for (const [key, name, kind] of forms) {
    await db.formTemplate.create({
      data: {
        salonId: salon.id,
        key,
        version: 1,
        name,
        kind,
        status: 'PUBLISHED',
        requiresSignature: true,
        // PLACEHOLDER WORDING. Must be drafted or reviewed by a qualified
        // attorney before any salon uses it with a real client.
        isLegalPlaceholder: true,
        bodyMarkdown:
          `## ${name}\n\n> **Placeholder wording — not legal advice.** This text exists so the ` +
          `flow can be built and tested. It must be drafted or reviewed by a qualified attorney ` +
          `for your jurisdiction before use with a client.\n\n` +
          `I confirm the information I have given about my hair and health is accurate, and I ` +
          `consent to the service discussed with my stylist.`,
      },
    })
  }

  await db.policy.create({
    data: {
      salonId: salon.id,
      type: 'CANCELLATION',
      version: 1,
      bodyMarkdown:
        '**Placeholder policy — not legal advice.** Appointments cancelled within 48 hours may ' +
        'incur a fee of 50% of the booked service.',
      configJson: { windowHours: 48, feePercent: 50 },
    },
  })

  // --- Retail --------------------------------------------------------------
  for (const [sku, name, price, cost] of [
    ['AUR-BOND-01', 'Bond repair treatment', 4200, 1800],
    ['AUR-PURP-01', 'Purple toning shampoo', 2800, 1100],
    ['AUR-OIL-01', 'Finishing oil', 3400, 1300],
  ] as const) {
    await db.retailProduct.create({
      data: {
        salonId: salon.id,
        sku,
        name,
        brand: 'Aurora Pro',
        priceCents: price,
        costCents: cost,
        stockQty: 24,
      },
    })
  }

  // --- A second salon, so tenant isolation is visible in the demo ----------
  const other = await db.salon.create({
    data: {
      slug: 'bloom',
      name: 'Bloom Hair Co',
      defaultTimezone: 'Europe/London',
      settings: { create: {} },
      subscription: { create: { planCode: 'PRO', status: 'ACTIVE' } },
      locations: { create: { name: 'Bloom — Soho', timezone: 'Europe/London' } },
      serviceCategories: { create: { name: 'Colour', slug: 'colour' } },
    },
  })

  const otherUser = await db.user.create({
    data: {
      email: 'owner@bloom.aurora.test',
      name: 'Bloom Owner',
      passwordHash,
      emailVerified: EPOCH,
    },
  })
  await db.membership.create({
    data: { salonId: other.id, userId: otherUser.id, role: 'OWNER', status: 'ACTIVE' },
  })
  await db.clientProfile.create({
    data: {
      salonId: other.id,
      firstName: 'Bloom',
      lastName: 'Client',
      email: 'c@bloom.aurora.test',
    },
  })

  console.log(`
▸ Seed complete

  Salon           Aurora Hair Studio  (/s/aurora)
  Second salon    Bloom Hair Co       (/s/bloom)     — for tenant isolation
  Locations       2 (New York, Chicago)
  Services        ${services.length} with real phase chains
  Staff           ${staff.length}
  Clients         ${clientIds.length}
  Appointments    ${appointments} completed, with matching quote-accuracy rows

  Logins — password for every account: ${PASSWORD}
    owner@aurora.test       Owner
    manager@aurora.test     Manager
    frontdesk@aurora.test   Front desk
    rowan@aurora.test       Stylist (senior colourist)
    client@aurora.test      Client
`)
}

main()
  .then(() => db.$disconnect())
  .catch(async (err) => {
    console.error('Seed failed:', err)
    await db.$disconnect()
    process.exit(1)
  })
