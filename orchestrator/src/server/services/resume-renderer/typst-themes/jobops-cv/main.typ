// JobOps adapted theme. The renderer replaces __RESUME_DATA_PATH__ with
// "resume-data.json" before compiling this document.
#let source = json(__RESUME_DATA_PATH__)

#set page(paper: "a4", margin: (x: 18mm, y: 16mm))
#set text(font: "Liberation Sans", size: 11pt, fill: rgb("000000"))
#set par(justify: false, leading: 0.42em)
#set heading(numbering: none)

#let ink = rgb("000000")
#let with-default(value, fallback) = {
  if value == none { fallback } else { value }
}
#let text-of(value) = with-default(value, "")
#let list-of(value) = with-default(value, ())
#let text-of-item(item, key) = text-of(item.at(key, default: ""))
#let markup-text(value) = if type(value) == str { eval(value, mode: "markup") } else { value }

#let name-style(body) = text(size: 18pt, weight: 700, fill: ink)[#body]
#let headline-style(body) = text(size: 18pt, weight: 700, fill: ink)[#body]
#let contact-style(body) = text(size: 10.5pt, weight: 400, fill: ink)[#body]
#let label-style(body) = text(size: 12pt, weight: 700, fill: ink)[#body]
#let body-style(body) = text(size: 11pt, weight: 400, fill: ink)[#body]
#let row-title(body) = text(size: 11pt, weight: 700, fill: ink)[#body]
#let date-style(body) = text(size: 11pt, weight: 700, fill: ink)[#body]

#let section(title) = [
  #v(11pt)
  #label-style(upper(title))
  #v(-5pt)
  #line(length: 100%, stroke: 0.5pt + ink)
  #v(-5pt)
]

#let link-or-text(label, url) = {
  if url == "" { label } else { link(url)[#label] }
}


#let entry-line(entry) = {
  let title = text-of-item(entry, "title")
  let subtitle = text-of-item(entry, "subtitle")
  let secondary = text-of-item(entry, "secondarySubtitle")
  let label = if subtitle == "" { title } else { subtitle + ": " + title }
  if secondary == "" { label } else { label + ", " + secondary }
}

#let bullets(entry) = {
  let items = list-of(entry.at("bullets", default: ()))
  if items.len() > 0 [
    #v(2pt)
    #set list(indent: 15pt, body-indent: 15pt)
    #set par(justify: true, leading: 0.62em)
    #list(
      tight: false,
      spacing: 9pt,
      ..items.map(item => [#body-style(markup-text(item))]),
    )
  ]
}

#let timeline-entry(entry, lead: none, heading: none, show-responsibilities: false) = {
  let title = if heading != none { heading } else { entry-line(entry) }
  let link = text-of-item(entry, "url")
  let date = text-of-item(entry, "date")
  let entry-bullets = list-of(entry.at("bullets", default: ()))
  [
    #grid(
      columns: (1fr, auto),
      column-gutter: 12pt,
      [
        #if lead != none [#lead]
        #if lead != none [#h(4pt)#text(size: 13.5pt)[—]#h(4pt)]
        #if link == "" [#row-title(title)] else [#row-title(link-or-text(title, link))]
      ],
      [#date-style(date)],
    )
    #if show-responsibilities and entry-bullets.len() > 0 [
      #text(size: 10.5pt)[Key responsibilities:]
    ]
    #bullets(entry)
    #v(4pt)
  ]
}

#let source-name = text-of(source.at("name", default: ""))
#let headline = text-of(source.at("headline", default: ""))
#let location = text-of(source.at("location", default: ""))
#let contact-items = list-of(source.at("contactItems", default: ()))
#let profile-items = list-of(source.at("profileItems", default: ()))
#let custom-field-items = list-of(source.at("customFieldItems", default: ()))
#let section-titles = with-default(source.at("sectionTitles", default: (:)), (:))

#align(left)[
  #name-style(source-name)
  #if headline != "" [#h(5pt)|#h(5pt)#headline-style(headline)]
]

#v(4pt)
#let contacts = ()
#if location != "" { contacts.push(location) }
#for item in contact-items {
  let label = text-of-item(item, "text")
  let url = text-of-item(item, "url")
  if label != "" { contacts.push(link-or-text(label, url)) }
}
#for item in profile-items {
  let url = text-of-item(item, "url")
  let username = text-of-item(item, "username")
  let network = text-of-item(item, "network")
  let label = if username != "" { username } else if network != "" { network } else { url }
  if label != "" { contacts.push(link-or-text(label, url)) }
}
#if contacts.len() > 0 [#contact-style(contacts.join([ #h(7pt)|#h(7pt) ]))]

#let skill-groups = list-of(source.at("skillGroups", default: ()))
#let languages = list-of(source.at("languages", default: ()))
#let summary = text-of(source.at("summary", default: ""))
#let education = list-of(source.at("education", default: ()))
#let experience = list-of(source.at("experience", default: ()))



#let render-skills() = {
  if skill-groups.len() > 0 [
    #text(weight: "bold")[SKILLS:]
    #h(3pt)
    #skill-groups.map(item => text-of-item(item, "name")).join(", ")
    #v(4pt)
  ]
}

#let render-languages() = {
  if languages.len() > 0 [
    #text(weight: "bold")[LANGUAGES:]
    #h(3pt)
    #text[Fluent in #languages.map(item => text-of-item(item, "language")).join(", ")]
    #v(4pt)
  ]
}

#let render-summary() = {
  if summary != "" [
    #section(text-of(section-titles.at("summary", default: "Summary")))
    #body-style(markup-text(summary))
  ]
}

#let render-profiles() = {}

#let render-entry-section(key, fallback) = {
  let entries = list-of(source.at(key, default: ()))
  if entries.len() > 0 [
    #section(text-of(section-titles.at(key, default: fallback)))
    #for entry in entries [#timeline-entry(entry)]
  ]
}

#let render-experience() = {
  let title = text-of(section-titles.at("experience", default: "Experience"))
  let title = if title == "Experience" { "Professional Experience" } else { title }
  if experience.len() > 0 [
    #section(title)
    #for entry in experience [
      #timeline-entry(
        entry,
        lead: text-of-item(entry, "title"),
        heading: text-of-item(entry, "subtitle"),
        show-responsibilities: true,
      )
    ]
  ]
}

#let render-interests() = {
  let items = list-of(source.at("interests", default: ()))
  if items.len() > 0 [
    #section(text-of(section-titles.at("interests", default: "Interests")))
    #grid(
      columns: 2,
      column-gutter: 10pt,
      row-gutter: 4pt,
      ..items.map(item => [
        #text(weight: "bold")[#text-of-item(item, "name")]
        #let keywords = list-of(item.at("keywords", default: ()))
        #if keywords.len() > 0 [
          #text(size: 8pt, fill: rgb("666666"))[#keywords.join(", ")]
        ]
      ]),
    )
  ]
}

#let render-custom-fields() = {
  if custom-field-items.len() > 0 [
    #section(text-of(section-titles.at("customFields", default: "Additional Information")))
    #for item in custom-field-items [
      #row-title(text-of-item(item, "title"))
      #if text-of-item(item, "title") != "" [#body-style(": ")]
      #link-or-text(text-of-item(item, "text"), text-of-item(item, "url"))
      #v(3pt)
    ]
  ]
}

#let default-section-order = (
  "profiles",
  "experience",
  "education",
  "projects",
  "skills",
  "languages",
  "interests",
  "awards",
  "certifications",
  "publications",
  "volunteer",
  "references",
)
#let section-order = list-of(source.at("sectionOrder", default: ()))
#let section-order = if section-order.len() == 0 {
  default-section-order
} else {
  section-order
}

#render-summary()
#render-custom-fields()
#for key in section-order {
  if key == "profiles" {
    render-profiles()
  } else if key == "experience" {
    render-experience()
  } else if key == "education" {
    render-entry-section("education", "Education")
  } else if key == "projects" {
    render-entry-section("projects", "Projects")
  } else if key == "skills" {
    render-skills()
  } else if key == "languages" {
    render-languages()
  } else if key == "interests" {
    render-interests()
  } else if key == "awards" {
    render-entry-section("awards", "Awards")
  } else if key == "certifications" {
    render-entry-section("certifications", "Certifications")
  } else if key == "publications" {
    render-entry-section("publications", "Publications")
  } else if key == "volunteer" {
    render-entry-section("volunteer", "Volunteer")
  } else if key == "references" {
    render-entry-section("references", "References")
  }
}
