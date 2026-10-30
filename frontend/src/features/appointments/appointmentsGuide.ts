import type { ModuleGuideContent } from '@/shared/ui';

export const appointmentsGuide: ModuleGuideContent = {
  titleKey: 'guide.appointments.title',
  titleDefault: "Appointments",
  introKey: 'guide.appointments.intro',
  introDefault:
    "Plan bookings for your services, staff and rooms, move them on the calendar and let customers book online.",
  sections: [
    {
      icon: 'Database',
      titleKey: 'guide.appointments.setup.title',
      titleDefault: "Set up services and resources",
      bodyKey: 'guide.appointments.setup.body',
      bodyDefault:
        "Add the services you offer with duration and price, and the staff, rooms or chairs that deliver them. Weekly hours and days off define when they can be booked.",
    },
    {
      icon: 'Workflow',
      titleKey: 'guide.appointments.calendar.title',
      titleDefault: "Calendar and list",
      bodyKey: 'guide.appointments.calendar.body',
      bodyDefault:
        "Click an empty time on the day or week calendar to book, and drag a booking to move it. The list shows the next 60 days and can be filtered by status.",
    },
    {
      icon: 'ListChecks',
      titleKey: 'guide.appointments.status.title',
      titleDefault: "Follow a booking through",
      bodyKey: 'guide.appointments.status.body',
      bodyDefault:
        "Move each booking from requested to confirmed, completed, cancelled or no-show, and create the invoice once the service is delivered.",
    },
    {
      icon: 'Send',
      titleKey: 'guide.appointments.online.title',
      titleDefault: "Online booking and reminders",
      bodyKey: 'guide.appointments.online.body_drafts',
      bodyDefault:
        "Share your public booking link so customers choose a free slot themselves, and prepare reminder drafts that you review and send yourself to cut no-shows.",
    },
  ],
  ctaKey: 'guide.appointments.cta',
  ctaDefault: "Create your first booking",
};
