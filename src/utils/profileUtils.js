export const PROFILE_OPTIONS = [
    {
        value: 'general',
        name: 'General Assistant',
        description: 'Adapt to any live conversation, diagnostic task, or workflow',
    },
    {
        value: 'interview',
        name: 'Job Interview',
        description: 'Get help with interview questions and ready-to-say responses',
    },
    {
        value: 'sales',
        name: 'Sales Call',
        description: 'Assist with discovery, demos, objection handling, and deal flow',
    },
    {
        value: 'support',
        name: 'Customer Support',
        description: 'Guide troubleshooting, escalations, and customer issue handling',
    },
    {
        value: 'meeting',
        name: 'Business Meeting',
        description: 'Support professional meetings, updates, and stakeholder discussions',
    },
    {
        value: 'presentation',
        name: 'Presentation',
        description: 'Help with presentations, demos, pitches, and public speaking',
    },
    {
        value: 'negotiation',
        name: 'Negotiation',
        description: 'Guide deal terms, pricing conversations, and contract discussions',
    },
    {
        value: 'exam',
        name: 'Exam Assistant',
        description: 'Provide concise academic help for tests and assessments',
    },
];

export const PROFILE_NAME_MAP = Object.freeze(
    PROFILE_OPTIONS.reduce((map, profile) => {
        map[profile.value] = profile.name;
        return map;
    }, {})
);

const PROFILE_RULES = [
    [
        'interview',
        /\b(interview|interviewer|candidate|recruiter|hiring manager|behavioral|technical screen|onsite|screening call)\b/i,
    ],
    [
        'support',
        /\b(customer support|support|help ?desk|service desk|ticket|incident|escalation|case|refund|complaint|sla)\b/i,
    ],
    [
        'sales',
        /\b(sales|prospect|prospecting|discovery call|customer discovery|objection|pipeline|close|closing|quota|account exec|account executive|sdr|bdr|renewal)\b/i,
    ],
    [
        'meeting',
        /\b(meeting|standup|sync|stakeholder|1:1|one-on-one|one on one|retro|retrospective|status update|team update)\b/i,
    ],
    [
        'presentation',
        /\b(presentation|presenting|pitch|deck|webinar|demo|keynote|public speaking|talk track)\b/i,
    ],
    [
        'negotiation',
        /\b(negotiation|negotiate|contract|pricing discussion|procurement|vendor terms|deal terms)\b/i,
    ],
    [
        'exam',
        /\b(exam|quiz|test prep|certification|assessment|homework|practice test)\b/i,
    ],
];

function normalizeText(value = '') {
    return String(value || '')
        .toLowerCase()
        .replace(/\s+/g, ' ')
        .trim();
}

export function normalizeProfile(profile = 'general') {
    return PROFILE_NAME_MAP[profile] ? profile : 'general';
}

export function getProfileName(profile = 'general') {
    return PROFILE_NAME_MAP[normalizeProfile(profile)] || 'General Assistant';
}

export function inferProfileFromFocus(focusConfig = {}, fallbackProfile = 'general') {
    const text = normalizeText([
        focusConfig?.jobTitle,
        focusConfig?.objective,
        focusConfig?.priorityTopics,
    ].join(' '));

    if (!text) {
        return normalizeProfile(fallbackProfile);
    }

    for (const [profile, pattern] of PROFILE_RULES) {
        if (pattern.test(text)) {
            return profile;
        }
    }

    return normalizeProfile(fallbackProfile);
}

export function getFocusLabel(focusConfig = {}, fallbackProfile = 'general') {
    const jobTitle = String(focusConfig?.jobTitle || '').trim();
    if (jobTitle) {
        return jobTitle;
    }
    return getProfileName(fallbackProfile);
}
