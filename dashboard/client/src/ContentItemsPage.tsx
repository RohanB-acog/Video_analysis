import React from "react";
import {
  Container,
  Typography,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Paper,
  Box,
  Button,
  TableSortLabel,
} from "@mui/material";
import { useLocation, useNavigate } from "react-router-dom";
import ChevronDownIcon from "@mui/icons-material/ExpandMore";
import ChevronUpIcon from "@mui/icons-material/ExpandLess";
import PlayArrowIcon from "@mui/icons-material/PlayArrow";
import { SxProps, useTheme, Theme } from "@mui/material";

interface ContentItem {
  video_id: string;
  title: string;
  description: string;
  url: string;
  published_date: string | null;
  view_count: number;
  video_type: string;
}

const ContentItemsPage: React.FC = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const theme = useTheme<Theme>();
  const { contentItems, contentTypeTitle } = (location.state as { contentItems: ContentItem[]; contentTypeTitle: string }) || {
    contentItems: [],
    contentTypeTitle: "Content Items",
  };

  const [sortDirection, setSortDirection] = React.useState<"asc" | "desc">("desc");
  const [sortField, setSortField] = React.useState<"published_date" | "view_count">("published_date");
  const [expandedDescriptions, setExpandedDescriptions] = React.useState<{ [key: string]: boolean }>({});
  const [expandedVideos, setExpandedVideos] = React.useState<{ [key: string]: boolean }>({});

  const cardStyles: SxProps<Theme> = {
    backgroundColor: "var(--card-background)",
    borderRadius: "12px",
    boxShadow: "var(--shadow-md)",
    border: "1px solid var(--border-light)",
    transition: "all 0.3s ease",
    "&:hover": {
      boxShadow: "var(--shadow-lg)",
      transform: "translateY(-4px)",
    },
  };

  const tableHeaderStyles: SxProps<Theme> = {
    backgroundColor: "var(--border-light)",
    "& th": {
      fontWeight: 600,
      color: "var(--text-primary)",
      padding: "14px",
    },
  };

  const tableRowStyles: SxProps<Theme> = {
    "&:nth-of-type(odd)": {
      backgroundColor: "rgba(245, 247, 250, 0.5)",
    },
    "&:hover": {
      backgroundColor: "rgba(42, 78, 122, 0.05)",
    },
    "& td": {
      padding: "14px",
      borderBottom: "1px solid var(--border-light)",
    },
  };

  const sortedData = [...contentItems].sort((a, b) => {
    if (sortField === "published_date") {
      const dateA = a.published_date ? new Date(a.published_date).getTime() : 0;
      const dateB = b.published_date ? new Date(b.published_date).getTime() : 0;
      return sortDirection === "asc" ? dateA - dateB : dateB - dateA;
    } else {
      const viewCountA = a.view_count ?? 0;
      const viewCountB = b.view_count ?? 0;
      return sortDirection === "asc" ? viewCountA - viewCountB : viewCountB - viewCountB;
    }
  });

  const handleSort = (field: "published_date" | "view_count") => {
    if (sortField === field) {
      setSortDirection(sortDirection === "asc" ? "desc" : "asc");
    } else {
      setSortField(field);
      setSortDirection("asc");
    }
  };

  const toggleDescription = (videoId: string) => {
    setExpandedDescriptions((prev) => ({
      ...prev,
      [videoId]: !prev[videoId],
    }));
  };

  const toggleVideo = (videoId: string) => {
    setExpandedVideos((prev) => ({
      ...prev,
      [videoId]: !prev[videoId],
    }));
  };

  return (
    <Container maxWidth="lg" sx={{ py: 6 }}>
      <Box sx={{ mb: 5, textAlign: "center" }}>
        <Typography
          variant="h3"
          gutterBottom
          sx={{
            color: "var(--text-primary)",
            fontWeight: 700,
            fontSize: { xs: "2rem", md: "2.75rem" },
            "&::after": {
              content: '""',
              display: "block",
              width: "60px",
              height: "3px",
              backgroundColor: "var(--primary-color)",
              margin: "12px auto",
              borderRadius: "2px",
            },
          }}
        >
          {contentTypeTitle}
        </Typography>
        <Button
          variant="outlined"
          onClick={() => navigate("/")}
          sx={{
            color: "var(--primary-color)",
            borderColor: "var(--primary-color)",
            "&:hover": { borderColor: "var(--primary-dark)", backgroundColor: "rgba(42, 78, 122, 0.05)" },
          }}
        >
          Back to Dashboard
        </Button>
      </Box>

      {sortedData.length === 0 ? (
        <Box sx={cardStyles}>
          <Box sx={{ p: 4, textAlign: "center" }}>
            <Typography variant="body1" sx={{ color: "var(--text-secondary)", fontWeight: 500 }}>
              No content found for this search term.
            </Typography>
          </Box>
        </Box>
      ) : (
        <TableContainer component={Paper} sx={cardStyles}>
          <Table>
            <TableHead sx={tableHeaderStyles}>
              <TableRow>
                <TableCell>Video ID</TableCell>
                <TableCell>Type</TableCell>
                <TableCell>Title</TableCell>
                <TableCell sx={{ width: "250px" }}>Description</TableCell>
                <TableCell>URL</TableCell>
                <TableCell>
                  <TableSortLabel
                    active={sortField === "published_date"}
                    direction={sortField === "published_date" ? sortDirection : "asc"}
                    onClick={() => handleSort("published_date")}
                  >
                    Published Date
                  </TableSortLabel>
                </TableCell>
                <TableCell>
                  <TableSortLabel
                    active={sortField === "view_count"}
                    direction={sortField === "view_count" ? sortDirection : "asc"}
                    onClick={() => handleSort("view_count")}
                  >
                    View Count
                  </TableSortLabel>
                </TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {sortedData.map((item) => {
                const isDescriptionExpanded = expandedDescriptions[item.video_id] || false;
                const isVideoExpanded = expandedVideos[item.video_id] || false;
                const description = item.description || "N/A";
                const truncatedDescription =
                  description.length > 100 ? description.substring(0, 100) + "..." : description;
                const videoId = item.url.match(/(?:youtube\.com\/(?:[^\/]+\/.+\/|(?:v|e(?:mbed)?)\/|.*[?&]v=)|youtu\.be\/)([^"&?\/\s]{11})/i)?.[1];

                return (
                  <React.Fragment key={item.video_id}>
                    <TableRow sx={tableRowStyles}>
                      <TableCell sx={{ color: "var(--text-primary)", fontWeight: 500 }}>{item.video_id}</TableCell>
                      <TableCell sx={{ color: "var(--text-primary)", fontWeight: 500 }}>{item.video_type}</TableCell>
                      <TableCell sx={{ color: "var(--text-primary)", fontWeight: 500 }}>{item.title}</TableCell>
                      <TableCell sx={{ width: "250px" }}>
                        {isDescriptionExpanded ? (
                          <>
                            <Typography sx={{ color: "var(--text-primary)" }}>{description}</Typography>
                            {description.length > 100 && (
                              <Button
                                variant="text"
                                size="small"
                                onClick={() => toggleDescription(item.video_id)}
                                endIcon={<ChevronUpIcon fontSize="small" />}
                                sx={{ color: "var(--primary-color)", fontWeight: 500, mt: 1 }}
                              >
                                Show Less
                              </Button>
                            )}
                          </>
                        ) : (
                          <>
                            <Typography sx={{ color: "var(--text-primary)" }}>{truncatedDescription}</Typography>
                            {description.length > 100 && (
                              <Button
                                variant="text"
                                size="small"
                                onClick={() => toggleDescription(item.video_id)}
                                endIcon={<ChevronDownIcon fontSize="small" />}
                                sx={{ color: "var(--primary-color)", fontWeight: 500, mt: 1 }}
                              >
                                Show More
                              </Button>
                            )}
                          </>
                        )}
                      </TableCell>
                      <TableCell>
                        <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                          <a
                            href={item.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            style={{ color: "var(--primary-color)", fontWeight: 500 }}
                          >
                            {item.url}
                          </a>
                          {videoId && (
                            <Button
                              variant="text"
                              size="small"
                              onClick={() => toggleVideo(item.video_id)}
                              startIcon={<PlayArrowIcon fontSize="small" />}
                              sx={{ color: "var(--primary-color)", fontWeight: 500 }}
                            >
                              {isVideoExpanded ? "Hide Video" : "View Video"}
                            </Button>
                          )}
                        </Box>
                      </TableCell>
                      <TableCell sx={{ color: "var(--text-primary)" }}>
                        {item.published_date ? new Date(item.published_date).toLocaleString() : "N/A"}
                      </TableCell>
                      <TableCell sx={{ color: "var(--text-primary)" }}>{item.view_count?.toLocaleString() || "N/A"}</TableCell>
                    </TableRow>
                    {isVideoExpanded && videoId && (
                      <TableRow>
                        <TableCell colSpan={7}>
                          <Box sx={{ display: "flex", justifyContent: "center", p: 2 }}>
                            <Box sx={{ width: "480px", position: "relative", paddingTop: "270px" /* 16:9 ratio: 480 / 1.777 ≈ 270 */ }}>
                              <iframe
                                src={`https://www.youtube.com/embed/${videoId}`}
                                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                                allowFullScreen
                                style={{
                                  position: "absolute",
                                  top: 0,
                                  left: 0,
                                  width: "100%",
                                  height: "100%",
                                  border: "none",
                                  borderRadius: "8px",
                                }}
                              />
                            </Box>
                          </Box>
                        </TableCell>
                      </TableRow>
                    )}
                  </React.Fragment>
                );
              })}
            </TableBody>
          </Table>
        </TableContainer>
      )}
    </Container>
  );
};

export default ContentItemsPage;
